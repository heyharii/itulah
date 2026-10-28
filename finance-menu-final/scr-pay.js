/* ═════════ Payables › Bills · Suppliers   ·   Accounting › Journal · Ledger ═════════
   Bills = 7Soft's Faktur Pembelian + Invoice Retur Beli; Suppliers = Info Pembelian, Kartu / Summary /
   Umur Hutang; Journal = Transaksi Jurnal; Ledger = Info Accounting, Buku Besar Pembantu, Neraca Saldo.
   One ledger engine feeds the kartu hutang, the buku besar and the neraca saldo: every posted document
   becomes balanced lines; cash, bank, hutang and outstanding giro are anchored to the books the other
   screens show, so a number reads the same everywhere and the neraca always balances. */
;(() => {
const W = window
const sum = (xs, f) => xs.reduce((a, x, i) => a + (f ? f(x, i) : x), 0)
const pad4 = n => String(n).padStart(4, '0')
const LOCS = ['00', ...STORES.map(s => s.loc)]
const UNITS = ['HO', ...STORES.map(s => s.code)]
const unitOf = loc => loc === '00' ? 'HO' : (STORES.find(s => s.loc === loc) || { code: loc }).code
const locOf = u => u === 'HO' ? '00' : (STORE[u] || {}).loc
const c12 = c => { c = String(c || ''); return c.length === 10 ? c + '00' : c }
const supName = c => SUP[c] ? SUP[c].name : c
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const MONTHF = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const periodOf = iso => `${MONTHF[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`
const nowHM = () => new Date().toTimeString().slice(0, 5)
const sheetEl = sel => document.querySelector('#layers .sheet-wrap:last-child ' + sel)
function refocus(sel) { const el = sheetEl(sel); if (!el) return; el.focus(); try { const n = el.value.length; el.setSelectionRange(n, n) } catch (e) { /* date and select inputs */ } }

/* accounts of the client's chart (Laporan_Master_Account, window.COA_N from Reports) that the ledger
   uses and the short GL list does not name — so the names read right even without Reports */
const GLX = {
  '2012201001': 'Biaya Gaji dan Upah YMHD', '2012201007': 'Biaya Pemakaian Listrik YMHD', '2012201008': 'Biaya Pemakaian Air Bersih YMHD', '2022402001': 'Pinjaman Jangka Panjang Bank BCA',
  '3013001001': 'Modal Setor', '3013001002': 'Laba (Rugi) Ditahan', '6010111001': 'Biaya Gaji Karyawan', '6010111002': 'Biaya Lembur', '7010110003': 'Biaya Sewa Bangunan Toko dan Gudang',
  '6010310013': 'Biaya Perlengkapan Toko dan Kantor', '8020111001': 'Biaya Bunga Pinjaman Bank', '1011202002': 'Kantong Belanja Plastik Ukuran SEDANG', '8010110006': 'Kehilangan Barang atau Selisih Stock Opname',
  '1021506002': 'FFE Toko dan Gudang', '1021606002': 'Akum Penyusu - FFE Toko dan Gudang', '7010214002': 'Biaya Depresiasi FFE Toko Dan Gudang', '1021506003': 'FFE Komputer', '1021606003': 'Akum Penyusu - FFE Komputer', '7010214003': 'Biaya Depresiasi FFE Komputer',
}
const COAN = () => W.COA_N || {}
const nameOf = base => GL[base] || COAN()[base] || GLX[base] || ''
const glKeys = () => [...new Set([...Object.keys(GL), ...Object.keys(GLX), ...Object.keys(COAN())])].filter(c => c.length === 10)
/* what Assets and Month end publish (scr-acc.js); read late, never at load */
/* Assets publishes window.ASSET_BOOK; its run is charged when October's charges are not empty, and the
   jurnal number it took is in History (window.FIN_HIST). Accumulated account per depreciation account: */
const ACCUM_OF = { '7010210002': '1021602002', '7010214002': '1021606002', '7010214003': '1021606003', '7010213001': '1021605001', '7010216002': '1031802002' }
const assets = () => { const B = W.ASSET_BOOK; if (!B) return null; const oct = B.charges('2026-10'), h = (W.FIN_HIST || []).find(x => x.menu === 'Assets' && /Penyusutan Okt/i.test(x.doc)); return { BOOK: B, oct, charged: oct.length > 0, ju: h && (h.doc.match(/JU\/HO\/\d{4}\/\d{4}/) || [])[0], at: h ? h.time : '' } }
/* Month end publishes window.FIN_CLOSE; the amounts are the ones its checklist and Reports use */
const ME_ACR = [{ n: 'Air PDAM Oktober · 9 lokasi', d: '6010310007', c: '2012201008', amt: 3245000, i: 1 }, { n: 'Lembur & insentif Oktober', d: '6010111002', c: '2012201001', amt: 46800000, i: 2 }]
const ME_STOCK = { C004: -2112000, C009: -1370500 }
const monthEnd = () => W.FIN_CLOSE && W.FIN_HIST ? { FC: W.FIN_CLOSE, H: W.FIN_HIST } : null
const LOCP = p => p === 'HO' ? '00' : STORE[p] ? STORE[p].loc : String(p).slice(2)

/* ═════════ bills: helpers ═════════ */
const isOpen = b => billLeft(b) > 0
const overdue = b => isOpen(b) && b.due < TODAY
const dueWeek = b => isOpen(b) && b.due >= TODAY && b.due <= addDays(TODAY, 7)
const supNon = code => { const xs = BILLS.filter(b => b.sup === code); return xs.length > 0 && xs.every(b => b.nonstock) }
const ppnOf = b => b.nonPpn ? 0 : b.total - Math.round(b.total * 100 / 111)
const tipeOf = b => b.tipe || (b.po ? 'MATCHING' : 'STANDARD')
const GIRO_OUT = g => g.state === 'with' || g.state === 'written'
/* three bills whose lines in the shared books did not add up to the total: the lines that do */
const LINE_FIX = {
  'FB/HO/2610/0142': [[0, 60, 120000], [1, 40, 148000], [2, 50, 61400], [10, 300, 41915]],
  'FB/HO/2610/0131': [[3, 100, 89000], [4, 50, 167000], [5, 20, 250000]],
  'FB/HO/2610/0128': [[6, 150, 173000], [7, 180, 280000]],
}
/* what the receipt (BPB) counted, where it differs from what was billed: bill → line → received */
const RCV_FIX = { 'FB/HO/2610/0145': { 1: 144 } }
function billLines(b) {
  const src = LINE_FIX[b.no] || b.lines
  const out = src.map(([a, qty, price, disc = 0], i) => {
    const art = typeof a === 'number' ? ARTICLES[a] : null
    return { a, art, desc: art ? art[1] : a, id: art ? art[0] : '', v: 101 + ((typeof a === 'number' ? a : 0) * 3 + i) % 8, qty, price, disc, sub: Math.round(qty * price) - disc }
  })
  const diff = b.total - sum(out, l => l.sub)
  if (diff && Math.abs(diff) < 1000 && out.length) out[out.length - 1].sub += diff
  return out
}
const kodeCell = l => l.art ? sku(l.id, l.v) : DASH
const artCell = l => l.art ? `<span class="nm">${esc(l.desc)}</span> <span class="mute">${l.id}</span>` : `<span class="one">${esc(l.desc)}</span>`
const retState = r => r.refundBy ? ['Refunded', 'ok'] : r.offsetNext ? ['Offsets next payment', 'info'] : ['Waiting refund', 'warn']
const supClosing = code => sum(BILLS.filter(b => b.sup === code), billLeft) - sum(RETURNS.filter(r => r.sup === code && !r.refundBy), r => r.total)
const nextNo = (xs, pre) => pre + pad4(Math.max(0, ...xs.filter(x => x.no.startsWith(pre)).map(x => +x.no.slice(-4))) + 1)

/* receipts (BPB) counted at the warehouse and not billed yet — Record bill picks from these */
const RCPT = [
  { sup: 'S-0102', po: 'PO-0102-OKT5', bpb: 'BPB-261026-003', date: '2026-10-26', lines: [[0, 80, 80, 120000], [3, 60, 58, 89000]] },
  { sup: 'S-0077', po: 'PO-0077-OKT1', bpb: 'BPB-251026-001', date: '2026-10-25', lines: [[6, 100, 100, 173000], [7, 60, 60, 112000]] },
  { sup: 'S-0131', po: 'PO-0131-OKT2', bpb: 'BPB-241026-004', date: '2026-10-24', lines: [[9, 50, 50, 166000]] },
  { sup: 'S-0118', po: 'PO-0118-OKT3', bpb: 'BPB-271026-002', date: '2026-10-27', lines: [[11, 300, 300, 38000], [8, 40, 40, 129000]] },
  { sup: 'S-0144', po: 'PO-0144-OKT1', bpb: 'BPB-231026-002', date: '2026-10-23', lines: [[10, 200, 196, 42500]] },
  { sup: 'S-0045', po: 'PO-0045-OKT2', bpb: 'BPB-261026-005', date: '2026-10-26', lines: [['Barcode scanner 2D nirkabel', 4, 4, 1250000]] },
  { sup: 'S-0215', po: 'PO-0215-OKT2', bpb: 'BPB-271026-001', date: '2026-10-27', lines: [['Kantong belanja plastik BESAR', 20000, 20000, 412]] },
]

/* ═════════ the ledger: every posted document as balanced lines ═════════ */
const HUT = non => (non ? '2012001003' : '2012001001') + '00'
const OG = { BCA: '201200200100', Mandiri: '201200200200', BRI: '201200200300' }
const PPN_IN = '101130200400'
const NONSTOCK_ACC = { 'S-0208': '6010310001', 'S-0045': '1021506003', 'S-0215': '1011202002' }
const bankAcc = bank => ACCOUNTS.find(a => a.kind === 'bank' && a.bank === bank && a.name.startsWith('Giro'))
const isHut = code => code.startsWith('20120010')
/* the power accrual per unit (HO + C001…C013), and the depreciation used only when Assets is not loaded */
const DEPR = { '00': 6225000, '01': 3150000, '02': 2480000, '03': 2760000, '04': 2115000, '05': 3420000, '06': 2940000, '07': 2050000, '08': 2635000, '09': 3280000, '10': 2905000, '11': 3575000, '12': 2330000, '13': 1985000 }
const ACCR = { '00': 2140000, '01': 1285000, '02': 1120000, '03': 1190000, '04': 1065000, '05': 1340000, '06': 1245000, '07': 1080000, '08': 1210000, '09': 1395000, '10': 1260000, '11': 1420000, '12': 1150000, '13': 1095000 }
const ACCR_SUM = sum(Object.values(ACCR))
const deprStatic = month => [...LOCS.map(l => ['7010214002', l, `Penyusutan ${month}`, DEPR[l], 0]), ...LOCS.map(l => ['1021606002', l, `Penyusutan ${month}`, 0, DEPR[l]])]
const accrLines = (month, rev) => [...LOCS.map(l => ['6010310006', l, `Pemakaian ${month}`, rev ? 0 : ACCR[l], rev ? ACCR[l] : 0]), ['2012201007', '00', `Listrik YMHD ${month}`, rev ? ACCR_SUM : 0, rev ? 0 : ACCR_SUM]]
const CLEAN = 291060
/* Transaksi Jurnal: the October entries typed by Finance (lines: account · unit · uraian · debet · kredit).
   Depreciation, the C011 prepaid, the Month end accruals and the stock adjustment are added below
   when Assets or Month end posts them, under the number they took. */
const JOURNALS = [
  { no: 'JU/HO/2610/0036', date: '2026-10-28', at: '10:05', ref: 'JU/HO/2610/0033', note: 'Reversal JU/HO/2610/0033 · PDAM C005 sudah dibayar terpisah', st: 'reversal', of: 'JU/HO/2610/0033', by: FIN, lines: [['6010310006', '00', 'Balik koreksi PDAM', 1215000, 0], ['6010310007', '00', 'Balik koreksi PDAM', 0, 1215000]] },
  { no: 'JU/HO/2610/0035', date: '2026-10-28', at: '09:40', ref: 'YMHD-LISTRIK-2610', note: 'Accrual listrik YMHD · pemakaian Oktober, tagihan November', st: 'posted', by: FIN, lines: accrLines('Oktober') },
  { no: 'JU/HO/2610/0034', date: '2026-10-24', at: '14:12', ref: 'FB/HO/2610/0140', note: 'Pembagian biaya kebersihan Oktober ke 13 toko', st: 'posted', by: FIN, lines: [...STORES.map(s => ['6010310001', s.loc, 'Kebersihan Oktober', CLEAN, 0]), ['6010310001', '00', 'Dibagi ke 13 toko', 0, CLEAN * 13]] },
  { no: 'JU/HO/2610/0033', date: '2026-10-22', at: '15:20', ref: 'BKK/HO/2610/0060', note: 'Koreksi akun: tagihan PDAM C005 ikut di BKK listrik', st: 'posted', by: FIN, lines: [['6010310007', '00', 'PDAM C005 Oktober', 1215000, 0], ['6010310006', '00', 'Keluar dari biaya listrik', 0, 1215000]] },
  { no: 'JU/HO/2610/0032', date: '2026-10-20', at: '11:02', ref: 'FB/HO/2610/0140', note: 'Reclass PPN Masukan dari biaya kebersihan', st: 'posted', by: FIN, lines: [['1011302004', '00', 'PPN Masukan FB/HO/2610/0140', 416216, 0], ['6010310001', '00', 'Keluar dari biaya kebersihan', 0, 416216]] },
  { no: 'JU/HO/2610/0031', date: '2026-10-01', at: '08:30', ref: 'JU/HO/2609/0047', note: 'Balik accrual listrik YMHD September', st: 'reversal', of: 'JU/HO/2609/0047', by: FIN, lines: accrLines('September', true) },
]
/* September is closed: what of it the ledger still needs */
const SEPT_J = [{ no: 'JU/HO/2609/0047', date: '2026-09-30', at: '16:40', ref: 'YMHD-LISTRIK-2609', note: 'Accrual listrik YMHD · pemakaian September, tagihan Oktober', st: 'posted', by: FIN, sept: true, lines: accrLines('September') }]
/* what Assets and Month end have posted, read from their state */
function dynJournals() {
  const out = [], A = assets(), M = monthEnd()
  const hj = re => { const h = M && M.H.find(x => x.menu === 'Month end' && re.test(x.doc)); const no = h && (h.doc.match(/JU\/HO\/\d{4}\/\d{4}/) || [])[0]; return no ? { no, date: h.date, at: h.time } : null }
  const run = (xs, u) => xs.flatMap(x => [[x.acc, x.loc, u, x.amt, 0], [ACCUM_OF[x.acc] || '1021606002', x.loc, u, 0, x.amt]])
  if (A) {
    const sep = A.BOOK.charges('2026-09')
    if (sep.length) out.push({ no: 'JU/HO/2609/0052', date: '2026-09-30', at: '23:55', ref: 'Assets · September 2026', note: 'Penyusutan & amortisasi aktiva, September 2026', st: 'posted', auto: true, by: FIN, sept: true, lines: run(sep, 'Penyusutan Sep 2026') })
    if (A.charged && A.ju) out.push({ no: A.ju, date: TODAY, at: A.at, ref: 'Assets · Oktober 2026', note: 'Penyusutan & amortisasi aktiva, Oktober 2026', st: 'posted', auto: true, by: FIN, lines: run(A.oct, 'Penyusutan Okt 2026') })
  } else {
    out.push({ no: 'JU/HO/2609/0052', date: '2026-09-30', at: '23:55', ref: 'AST-2609', note: 'Penyusutan aset tetap September 2026', st: 'posted', auto: true, by: FIN, sept: true, lines: deprStatic('September') })
    out.push({ no: 'JU/HO/2610/0030', date: '2026-10-27', at: '23:55', ref: 'AST-2610', note: 'Penyusutan aset tetap Oktober 2026', st: 'posted', auto: true, by: FIN, lines: deprStatic('Oktober') })
  }
  if (M) {
    const hp = M.FC.prepaid && hj(/Sewa toko C011/)
    if (hp) out.push({ ...hp, ref: 'Month end · Prepaid', note: 'Amortisasi sewa dibayar dimuka C011 Sipin, Oktober', st: 'posted', by: FIN, lines: [['7010110003', '11', 'Sewa toko C011 · Aug–Oct · Oktober', 15000000, 0], ['1011301003', '11', 'Amortisasi Oktober', 0, 15000000]] })
    const acc = ME_ACR.filter(a => M.FC.acc && M.FC.acc[a.i]), ha = acc.length && hj(/Air PDAM|lembur/i)
    if (ha) out.push({ ...ha, ref: 'Month end · Accruals', note: `Accrual Oktober · ${acc.map(a => a.n.split(' · ')[0]).join(' · ')}`, st: 'posted', by: FIN, lines: acc.flatMap(a => [[a.d, '00', a.n, a.amt, 0], [a.c, '00', a.n, 0, a.amt]]) })
    const hs = M.FC.stock && hj(/8010110006/)
    if (hs) out.push({ ...hs, ref: 'Month end · Stock opname', note: 'Selisih stock opname · C004 · C009', st: 'posted', by: FIN, lines: Object.entries(ME_STOCK).flatMap(([shop, v]) => [['8010110006', STORE[shop].loc, `Selisih stock ${shop}`, -v, 0], ['1011201001', STORE[shop].loc, `Selisih stock ${shop}`, 0, -v]]) })
  } else out.push({ no: 'JU/HO/2610/0029', date: '2026-10-01', at: '08:20', ref: 'SEWA-C011-AGS-OKT', note: 'Amortisasi sewa dibayar dimuka C011 Sipin, Oktober', st: 'posted', by: FIN, lines: [['7010110003', '11', 'Sewa toko Oktober', 15000000, 0], ['1011301003', '11', 'Amortisasi 3 dari 3', 0, 15000000]] })
  return out
}
const dynKey = () => { const A = assets(), M = monthEnd(); return `${A ? A.charged + A.ju : '-'}|${M ? JSON.stringify(M.FC) + M.H.length : '-'}` }
let DYN = { k: null, v: [] }
const dynJ = () => { const k = dynKey(); if (k !== DYN.k) DYN = { k, v: dynJournals() }; return DYN.v }
const allJ = () => [...dynJ().filter(j => !j.sept), ...JOURNALS].sort((x, y) => y.no.localeCompare(x.no))
const septJ = () => [...SEPT_J, ...dynJ().filter(j => j.sept)]
const jFind = no => allJ().find(j => j.no === no) || septJ().find(j => j.no === no)
const revOf = no => [...allJ(), ...septJ()].find(j => j.of === no)
const stOf = j => revOf(j.no) ? 'reversed' : j.st
const JST = { posted: ['Posted', 'ok'], reversed: ['Reversed', ''], reversal: ['Reversal', 'info'] }
const jTotal = j => sum(j.lines, l => l[3])
/* what the October run books: Assets' own lines once charged, else September's monthly charge as the estimate */
const deprRun = () => { const A = assets(); if (!A) return deprStatic('Oktober'); const xs = A.charged ? A.oct : A.BOOK.charges('2026-09'); return xs.flatMap(x => [[x.acc, x.loc, 'Penyusutan Okt 2026', x.amt, 0], [ACCUM_OF[x.acc] || '1021606002', x.loc, 'Penyusutan Okt 2026', 0, x.amt]]) }

function billLegs(b) {
  const non = !!b.nonstock, ppn = ppnOf(b)
  const exp = (non ? NONSTOCK_ACC[b.sup] || '6010310013' : '5010110001') + '00'
  /* the cleaning bill went to expense whole; JU/HO/2610/0032 moved its PPN out */
  if (b.no === 'FB/HO/2610/0140') return [[exp, b.total, 0], [HUT(non), 0, b.total, b.sup, b.inv]]
  return [[exp, b.total - ppn, 0], [PPN_IN, ppn, 0], [HUT(non), 0, b.total, b.sup, b.inv]]
}
function buildLines() {
  const L = []
  const add = (head, legs) => legs.forEach(([code, dr, cr, sup, ref]) => { if (code && (dr || cr)) L.push({ ...head, code: c12(code), dr, cr, sup, ref }) })
  BILLS.forEach(b => add({ date: b.date, src: 'Bill', no: b.no, what: supName(b.sup), on: `openBill('${b.no}')` }, billLegs(b)))
  RETURNS.forEach(r => {
    const non = supNon(r.sup), ppn = r.total - Math.round(r.total * 100 / 111)
    add({ date: r.date, src: 'Bill', no: r.no, what: `Retur · ${supName(r.sup)}`, on: `openPurchaseReturn('${r.no}')` },
      [[HUT(non), r.total, 0, r.sup, r.reason], [(non ? NONSTOCK_ACC[r.sup] || '6010310013' : '5010110001') + '00', 0, r.total - ppn], [PPN_IN, 0, ppn]])
  })
  VOUCHERS.bkk.filter(v => v.st === 'posted').forEach(v => {
    const a = ACC[v.acc], legs = []
    ;(v.settle || []).forEach(([no, amt]) => { const b = BILLS.find(x => x.no === no); legs.push([HUT(b && b.nonstock), amt, 0, v.party, v.method === 'giro' ? `${no} · BG ${v.giro}` : no]) })
    ;(v.other || []).forEach(([acc, , amt]) => legs.push([c12(acc), amt, 0]))
    legs.push([v.method === 'giro' && OG[a.bank] ? OG[a.bank] : a.code, 0, sum(legs.filter(l => l[0]), l => l[1])])
    add({ date: v.date, src: 'BKK', no: v.no, what: v.party ? supName(v.party) : v.what, on: `openDoc('bkk','${v.no}')` }, legs)
  })
  VOUCHERS.bkm.filter(v => v.st === 'posted').forEach(v => {
    const legs = []
    ;(v.other || []).forEach(([acc, , amt]) => legs.push([c12(acc), 0, amt]))
    ;(v.offset || []).forEach(([no, amt]) => legs.push([HUT(supNon(v.party)), 0, amt, v.party, `Refund ${no}`]))
    legs.unshift([ACC[v.acc].code, sum(legs.filter(l => l[0]), l => l[2]), 0])
    add({ date: v.date, src: 'BKM', no: v.no, what: v.party ? supName(v.party) : v.what, on: `openDoc('bkm','${v.no}')` }, legs)
  })
  GIROS.forEach(g => {
    const on = `pyGiro('${g.no}')`
    if (!docOf(g.bkk)) add({ date: g.written, src: 'BKK', no: g.bkk, what: supName(g.sup), on }, [[HUT(supNon(g.sup)), g.amt, 0, g.sup, `BG ${g.no}`], [OG[g.bank], 0, g.amt]])
    if (g.state === 'cleared' && g.cleared) add({ date: g.cleared, src: 'Giro', no: `BG ${g.no}`, what: `Cleared · ${supName(g.sup)}`, on }, [[OG[g.bank], g.amt, 0], [ACC[g.acc].code, 0, g.amt]])
    if (g.state === 'bounced') add({ date: g.bounced, src: 'Giro', no: `BG ${g.no}`, what: `Bounced · ${supName(g.sup)}`, on }, [[OG[g.bank], g.amt, 0], [HUT(supNon(g.sup)), 0, g.amt, g.sup, `BG ${g.no} bounced`]])
  })
  GIRO_OPENING.filter(g => g.state === 'cleared').forEach(g => add({ date: g.cleared, src: 'Giro', no: `BG ${g.no}`, what: `Cleared · ${supName(g.sup)}`, on: "go('giro')" }, [[OG[g.bank], g.amt, 0], [bankAcc(g.bank).code, 0, g.amt]]))
  /* the store days the Cash & Bank kartu shows (24–27 Oct): takings, the next day's deposit, the EDC credit */
  ;['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'].forEach(date => STORES.forEach(s => {
    const d = closeOf(date, s.code), loc = s.loc
    if (stateOf(d) !== 'posted' || d.counted == null) return
    const legs = [['1011001001' + loc, d.counted, 0]]
    if (d.diff < 0) legs.push(['1011102001' + loc, -d.diff, 0])
    if (d.diff > 0) legs.push(['8010110002' + loc, 0, d.diff])
    if (d.t.cash > d.cashExp) legs.push(['4010214001' + loc, d.t.cash - d.cashExp, 0])
    legs.push(['1011101002' + loc, d.t.debit + d.t.qris, 0], ['1011101001' + loc, d.t.credit, 0], ['4010110001' + loc, 0, d.gross - d.tax], ['2012101003' + loc, 0, d.tax])
    add({ date, src: 'Daily close', no: `${s.code} · ${dayS(date)}`, what: 'Takings', on: `openClose('${date}','${s.code}')` }, legs)
    const dep = round(d.cashExp * .96, 1000)
    add({ date: addDays(date, 1), src: 'Daily close', no: `Deposit ${s.code}-${date.slice(8)}`, what: `To Giro ${s.edc}`, on: "go('store-cash')" }, [[bankAcc(s.edc).code, dep, 0], ['1011001001' + loc, 0, dep]])
  }))
  ;['bca', 'mdr', 'bri'].map(id => ACC[id]).forEach(a => [24, 25, 26].forEach(dd => {
    const date = `2026-10-${dd}`, shops = STORES.filter(s => s.edc === a.bank), legs = []
    shops.forEach(s => { const d = closeOf(date, s.code); if (stateOf(d) === 'posted') legs.push(['1011101002' + s.loc, 0, d.t.debit + d.t.qris], ['1011101001' + s.loc, 0, d.t.credit]) })
    legs.unshift([a.code, sum(legs, l => l[2]), 0])
    add({ date, src: 'Daily close', no: `EDC ${a.bank} · ${dayS(date)}`, what: `Card & QRIS · ${plural(shops.length, 'shop')}`, on: "go('daily-close')" }, legs)
  }))
  ;[...septJ(), ...allJ()].forEach(j => add({ date: j.date, src: j.auto ? 'Depreciation' : 'Manual', no: j.no, what: j.note, on: `openJournal('${j.no}')` }, j.lines.map(([b, loc, , dr, cr]) => [b + loc, dr, cr])))
  /* September is closed: its profit and loss went to Laba (Rugi) Ditahan */
  const pl = {}
  ;[...L, ...extra().L].filter(l => l.date <= '2026-09-30' && PL(l.code)).forEach(l => { pl[l.code] = (pl[l.code] || 0) + l.dr - l.cr })
  const cl = Object.entries(pl).filter(([, v]) => v).map(([code, v]) => [code, v < 0 ? -v : 0, v > 0 ? v : 0]), net = sum(cl, l => l[1] - l[2])
  cl.push([PLUG, net < 0 ? -net : 0, net > 0 ? net : 0])
  add({ date: '2026-09-30', src: 'Month end', no: 'Tutup buku · Sep 2026', what: 'Laba (rugi) September ke Laba Ditahan', on: "go('month-end')" }, cl)
  return L
}
let LCACHE = null, LKEY = '', OCACHE = null
function lines() {
  const k = [BILLS.length, sum(BILLS, b => b.paid), RETURNS.length, VOUCHERS.bkk.map(v => v.no + v.st).join(), VOUCHERS.bkm.map(v => v.no + v.st).join(), GIROS.map(g => g.no + g.state).join(), POSTED_NOW.size, JOURNALS.map(j => j.no + (j.of || '')).join(), dynKey()].join('|')
  if (k !== LKEY) { LKEY = k; LCACHE = buildLines(); OCACHE = null }
  return LCACHE
}

/* the store days before 24 Oct, shown in the buku besar of sales and PPN; their sums sit in the opening */
const EXTRA_BASES = ['4010110001', '4010214001', '2012101003']
let XC = null
function extra() {
  if (XC) return XC
  const L = [], fold = {}
  for (let date = '2026-09-01'; date <= '2026-10-23'; date = addDays(date, 1)) STORES.forEach(s => {
    const d = closeOf(date, s.code), head = { date, src: 'Daily close', no: `${s.code} · ${dayS(date)}`, what: 'Takings', on: `openClose('${date}','${s.code}')` }
    ;[['4010110001' + s.loc, 0, d.gross - d.tax], ['2012101003' + s.loc, 0, d.tax], ...(d.t.cash > d.cashExp ? [['4010214001' + s.loc, d.t.cash - d.cashExp, 0]] : [])]
      .forEach(([code, dr, cr]) => { L.push({ ...head, code, dr, cr }); fold[code] = (fold[code] || 0) + dr - cr })
  })
  return XC = { L, fold }
}

/* BCA Kredit Investasi: anuitas, debited from Giro BCA on the 15th */
const LOAN = { bank: 'BCA', name: 'Kredit Investasi BCA', no: 'KI 0262-0047-2025', plafon: 1500000000, rate: .0975, n: 36, first: '2025-07-15', acc: 'bca', purpose: 'Renovasi 4 toko + gudang Cikupa' }
const monthAdd = (iso, k) => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + k; return `${y + Math.floor(m / 12)}-${String(m % 12 + 1).padStart(2, '0')}-${iso.slice(8)}` }
let LR = null
function loanRows() {
  if (LR) return LR
  const r = LOAN.rate / 12, A = Math.round(LOAN.plafon * r / (1 - Math.pow(1 + r, -LOAN.n)))
  let bal = LOAN.plafon, nextSet = false
  LR = []
  for (let i = 1; i <= LOAN.n; i++) {
    const due = monthAdd(LOAN.first, i - 1), bunga = Math.round(bal * r), pokok = i === LOAN.n ? bal : A - bunga
    bal -= pokok
    const st = due < TODAY ? 'paid' : nextSet ? 'plan' : 'next'
    if (st === 'next') nextSet = true
    LR.push({ i, due, pokok, bunga, ang: pokok + bunga, sisa: bal, st })
  }
  return LR
}
const loanLeft = () => { const xs = loanRows().filter(x => x.st === 'paid'); return xs.length ? xs[xs.length - 1].sisa : LOAN.plafon }

/* opening balances (before 1 Sep). The books close every month: profit and loss goes to Laba (Rugi)
   Ditahan, so only balance-sheet accounts open. Fixed where nothing else knows them; anchored where
   another screen does — cash and bank (Cash & Bank), hutang (Bills), outstanding giro (Giro), the asset
   book (Assets), stock (Reports) — so today's balance is that screen's figure. Laba Ditahan takes what
   is left, so the neraca always balances. */
let FIX = null
const PL = code => /^[45678]/.test(code)
function fixedOpen() {
  if (FIX) return FIX
  const o = {}, add = (base, loc, v) => { const k = base + loc; o[k] = (o[k] || 0) + Math.round(v) }, A = assets()
  let sd = 4242
  const r = () => { sd = (sd * 1103515245 + 12345) % 2147483648; return sd / 2147483648 }
  STORES.forEach(s => {
    add('1011201001', s.loc, round(260e6 + r() * 80e6, 1000))
    const ac = round(DEPR[s.loc] * 60 * (.3 + r() * .25), 1000)
    if (!A) { add('1021506002', s.loc, DEPR[s.loc] * 60); add('1021606002', s.loc, -ac) }
  })
  /* the store days shown before 24 Oct: their sales and PPN, closed with September or still in October */
  Object.entries(extra().fold).forEach(([code, v]) => { o[code] = (o[code] || 0) + v })
  add('1011201001', '00', 6482350000); add('1011203001', '00', 48650000); add('1011202002', '00', 6580000)
  add('1011301003', '11', 15000000); add('1011302004', '00', 41286400); add('1011102001', '00', 1150000); add('1011102002', '00', 1500000)
  if (!A) { add('1021506002', '00', 1265400000); add('1021606002', '00', -486220000) }
  add('2012101002', '00', -2145000); add('2012304001', '00', -21640000); add('2022402001', '00', -loanLeft()); add('3013001001', '00', -6000000000)
  return FIX = o
}
const PLUG = '301300100200'
function opening() {
  const L = lines()
  if (OCACHE) return OCACHE
  const o = { ...fixedOpen() }, moved = {}
  L.forEach(l => { moved[l.code] = (moved[l.code] || 0) + l.dr - l.cr })
  const anchor = (code, target) => { o[code] = target - (moved[code] || 0) }
  ACCOUNTS.forEach(a => anchor(a.code, a.books))
  anchor(HUT(false), -sum(SUPPLIERS.filter(s => !supNon(s.code)), s => supClosing(s.code)))
  anchor(HUT(true), -sum(SUPPLIERS.filter(s => supNon(s.code)), s => supClosing(s.code)))
  Object.entries(OG).forEach(([bank, code]) => anchor(code, -sum(GIROS.filter(g => g.bank === bank && GIRO_OUT(g) && (!docOf(g.bkk) || docOf(g.bkk).st === 'posted')), g => g.amt)))
  /* the asset register: cost and accumulated per account, the year's charge per account and unit */
  const codesOf = base => Object.keys({ ...o, ...moved }).filter(c => c.slice(0, 10) === base)
  const anchorBase = (base, target) => { const cs = codesOf(base), ho = base + '00'; o[ho] = target - sum(cs.filter(c => c !== ho), c => o[c] || 0) - sum(cs, c => moved[c] || 0) }
  const A = assets()
  if (A) Object.entries(A.BOOK.at('2026-10').byAcc).forEach(([base, v]) => anchorBase(base, v))
  if (W.FIN_BS && W.FIN_BS.inv) anchorBase('1011201001', W.FIN_BS.inv())
  delete o[PLUG]
  o[PLUG] = -sum(Object.values(o))
  return OCACHE = { o, moved }
}
const normalD = base => /^[1567]/.test(base) || /^80[23]/.test(base)
const sn = (base, v) => normalD(base) ? v : -v
/* trial balance per 10-digit account up to a date (Dr − Cr) */
function tbAt(date) {
  const { o } = opening(), net = {}
  const put = (code, v) => { const b = code.slice(0, 10); net[b] = (net[b] || 0) + v }
  Object.entries(o).forEach(([c, v]) => put(c, v))
  lines().forEach(l => { if (l.date <= date) put(l.code, l.dr - l.cr) })
  return net
}
/* buku besar pembantu for one account (all units or one), this month or last */
function bbp(base, unit, per) {
  const [from, to] = per === 'last' ? ['2026-09-01', '2026-09-30'] : ['2026-10-01', TODAY]
  const loc = unit === 'all' ? null : locOf(unit)
  const match = code => code.slice(0, 10) === base && (!loc || code.slice(10) === loc)
  const run = (awal, rows) => { let s = awal; return rows.map(r => ({ ...r, bal: s += sn(base, r.dr - r.cr) })) }
  if (ACCOUNTS.some(a => a.code.slice(0, 10) === base)) {
    const accs = ACCOUNTS.filter(a => match(a.code)), ks = accs.map(a => kartuOf(a)), open = sum(ks, k => k.open)
    if (per === 'last') return { awal: open, akhir: open, dr: 0, cr: 0, rows: [], kartu: 1 }
    const rows = ks.flatMap(k => k.rows).sort((x, y) => x.date.localeCompare(y.date)).map(r => ({ date: r.date, no: r.doc, what: r.what + (r.note ? ` · ${r.note}` : ''), dr: r.amt > 0 ? r.amt : 0, cr: r.amt < 0 ? -r.amt : 0, on: r.on }))
    return { awal: open, akhir: sum(accs, a => a.books), dr: sum(rows, r => r.dr), cr: sum(rows, r => r.cr), rows: run(open, rows), kartu: 1 }
  }
  const { o, moved } = opening()
  let now = 0
  new Set([...Object.keys(o), ...Object.keys(moved)]).forEach(c => { if (match(c)) now += (o[c] || 0) + (moved[c] || 0) })
  const disp = [...lines().filter(l => match(l.code)), ...(EXTRA_BASES.includes(base) ? extra().L.filter(l => match(l.code)) : [])]
  const akhirDC = now - sum(disp.filter(l => l.date > to), l => l.dr - l.cr)
  const inP = disp.filter(l => l.date >= from && l.date <= to).sort((x, y) => x.date.localeCompare(y.date) || x.no.localeCompare(y.no))
  const awalDC = akhirDC - sum(inP, l => l.dr - l.cr)
  return { awal: sn(base, awalDC), akhir: sn(base, akhirDC), dr: sum(inP, l => l.dr), cr: sum(inP, l => l.cr), rows: run(sn(base, awalDC), inP.map(l => ({ date: l.date, no: l.no, what: l.what, dr: l.dr, cr: l.cr, on: l.on }))) }
}
const COA_GROUPS = [
  ['Kas & Setara Kas', c => c.startsWith('10110')], ['Piutang', c => c.startsWith('10111')], ['Persediaan', c => c.startsWith('10112')],
  ['Biaya dibayar dimuka', c => c.startsWith('10113')], ['Aset tetap', c => /^102(15|16|17)|^103/.test(c)], ['Hutang', c => c.startsWith('2')], ['Ekuitas', c => c.startsWith('3')],
  ['Pendapatan', c => c.startsWith('4')], ['HPP', c => c.startsWith('5')], ['Beban', c => /^[67]/.test(c)], ['Pendapatan & biaya lain', c => c.startsWith('8')],
]
/* the accounts the ledger shows: the short GL list plus every account that holds a balance or a line */
const coaBases = () => { const { o } = opening(); return [...new Set([...Object.keys(GL), ...Object.keys(GLX), ...Object.keys(o).map(c => c.slice(0, 10)), ...lines().map(l => l.code.slice(0, 10))])].filter(c => c.length === 10).sort() }
const groupOf = base => (COA_GROUPS.find(([, f]) => f(base)) || ['Other'])[0]
/* kartu hutang of one supplier, October, with the running balance */
function kartuHutang(code) {
  const oct = lines().filter(l => l.sup === code && isHut(l.code) && l.date >= '2026-10-01').sort((x, y) => x.date.localeCompare(y.date) || (y.cr - x.cr))
  const close = supClosing(code), open = close - sum(oct, l => l.cr - l.dr)
  let bal = open
  return { open, close, rows: oct.map(l => ({ ...l, bal: bal += l.cr - l.dr })) }
}
const lastPaid = code => lines().filter(l => l.sup === code && isHut(l.code) && l.dr > 0 && l.src === 'BKK').map(l => l.date).sort().pop()

/* ═════════ Payables › Bills ═════════ */
const sel = () => (S.sel.bills = (S.sel.bills || []).filter(no => { const b = BILLS.find(x => x.no === no); return b && isOpen(b) }))
const billKey = b => ({ New: 'new', 'Part paid': 'part', Lunas: 'lunas', 'Giro bounced': 'bounced', Overdue: 'overdue' })[billState(b)[0]]
const REC = [
  { name: 'Kebersihan HO + 13 toko', to: 'Graha Clean, PT', sup: 'S-0208', every: 'Monthly · 18th', amt: 4200000, next: '2026-11-18', last: 'FB/HO/2610/0140', kind: 'bill', line: 'Kontrak kebersihan HO + 13 toko, Nov' },
  { name: 'Listrik 13 toko + HO', to: 'PLN (Persero)', every: 'Monthly · 27th', amt: 18452300, next: '2026-11-27', last: 'BKK/HO/2610/0060', kind: 'bkk', acc: 'bca', ref: 'PLN-ID 5321 0088', other: ['6010310006', 'Listrik November · 14 lokasi'], note: 'Listrik 13 toko + HO, November' },
  { name: 'Air PDAM 14 lokasi', to: 'PDAM (14 lokasi)', every: 'Monthly · 25th', amt: 2365000, next: '2026-11-25', last: null, kind: 'bkk', acc: 'bca', ref: '', other: ['6010310007', 'Air November · 14 lokasi'], note: 'Air PDAM 14 lokasi, November' },
  { name: 'Sewa toko C011 Sipin', to: 'Darmawan Hadi Saputra', every: 'Every 3 months · 14th', amt: 45000000, next: '2027-01-14', last: 'BKK/HO/2610/0050', kind: 'bkk', acc: 'mdr', ref: '', other: [acc('1011301003', '11'), 'Sewa 3 bulan dibayar dimuka'], note: 'Sewa toko C011 Sipin, Feb–Apr' },
]

reg({
  id: 'bills', group: 'pay', label: 'Bills',
  s7: [['Faktur Pembelian'], ['Invoice Retur Beli', 'returns'], ['Info Pembelian · Pembelian & Retur']],
  badge: () => { const n = BILLS.filter(overdue).length; return n ? [n, 'warn'] : null },
  render() {
    const id = 'bills', tab = tabOf(id, 'bills')
    const open = BILLS.filter(isOpen), od = open.filter(overdue), wk = open.filter(dueWeek), chk = open.filter(b => b.matchIssue)
    const kpis = [
      { label: 'Owed', value: money(sum(open, billLeft)) },
      { label: 'Due this week', value: `${wk.length} · ${money(sum(wk, billLeft))}` },
      { label: 'Overdue', value: `${od.length} · ${money(sum(od, billLeft))}`, tone: od.length ? 'bad' : '', on: "S.tab.bills='bills';setFilt('bills','st','overdue')" },
      { label: 'To check', value: String(chk.length), tone: chk.length ? 'warn' : '', on: chk.length === 1 ? `openBill('${chk[0].no}')` : "S.tab.bills='bills';setFilt('bills','st','check')" },
    ]
    let body
    if (tab === 'bills') {
      const f = filt(id, 'st', 'all'), sp = filt(id, 'sup', 'all'), ticked = sel()
      const n = k => BILLS.filter(b => k === 'overdue' ? overdue(b) : billKey(b) === k).length
      const rows = BILLS.filter(b => f === 'all' || (f === 'overdue' ? overdue(b) : f === 'check' ? isOpen(b) && !!b.matchIssue : billKey(b) === f))
        .filter(b => sp === 'all' || b.sup === sp).filter(b => hit(S.q[id], b.no, b.inv, supName(b.sup), b.po, b.bpb))
        .sort((x, y) => isOpen(y) - isOpen(x) || (isOpen(x) ? x.due.localeCompare(y.due) : y.date.localeCompare(x.date)))
      const tSup = ticked.length ? BILLS.find(b => b.no === ticked[0]).sup : null
      const pay = ticked.length ? `${lnk('Clear', 'pyClear()', 'x')}${btn(`Pay ${plural(ticked.length, 'bill')} · ${money(sum(ticked, no => billLeft(BILLS.find(b => b.no === no))))}`, `pyPay('${tSup}',[${ticked.map(x => `'${x}'`).join(',')}])`)}` : ''
      body = bar(chips(id, 'st', [['all', 'All', BILLS.length], ['new', 'New', n('new')], ['part', 'Part paid', n('part')], ['overdue', 'Overdue', n('overdue'), 'clock'], ['lunas', 'Lunas', n('lunas')], ['bounced', 'Giro bounced', n('bounced'), 'alert']], 'all'),
        selectBox([['all', 'Every supplier'], ...SUPPLIERS.map(s => [s.code, s.name])], sp, `setFilt('${id}','sup',this.value)`), search(id, 'Bill, invoice, PO or supplier'), spacer, pay)
        + table({
          cols: [{ l: '', k: 'ck', w: 44, cls: 'ck' }, { l: 'Bill', k: 'no', w: 170 }, { l: 'Supplier', k: 'sup' }, { l: 'Due', k: 'due', w: 90 }, { l: 'Amount', k: 'amt', num: 1, w: 160 }, { l: 'Left', k: 'left', num: 1, w: 160 }, { l: 'Status', k: 'st', w: 160 }],
          rows: rows.map(b => {
            const [w, tone] = billState(b), on = ticked.includes(b.no)
            return { cls: on ? 'sel' : '', on: `openBill('${b.no}')`, c: { ck: isOpen(b) ? `<input type="checkbox" class="cb" ${on ? 'checked' : ''} onclick="event.stopPropagation()" onchange="pyTick('${b.no}',this.checked,this)" aria-label="Pay ${b.no}">` : '', no: `<span class="nm">${b.no}</span>`, sup: `<span class="one">${esc(supName(b.sup))}</span>`, due: overdue(b) ? `<span class="bad">${dayS(b.due)}</span>` : dayS(b.due), amt: money(b.total), left: isOpen(b) ? money(billLeft(b)) : DASH, st: st(w, tone) } }
          }),
          foot: { no: plural(rows.length, 'bill'), amt: money(sum(rows, b => b.total)), left: money(sum(rows, billLeft)) },
          empty: 'No bill matches',
        })
    } else if (tab === 'returns') {
      const rows = RETURNS.filter(r => hit(S.q[id + 'r'], r.no, r.bill, r.reason, supName(r.sup)))
      body = bar(`<label class="ds-search">${ico('search')}<input type="search" placeholder="Retur no, bill or supplier" value="${esc(S.q[id + 'r'] || '')}" oninput="S.q['${id}r']=this.value;renderKeep()"></label>`, spacer, `<span class="bar-count">${plural(rows.length, 'return')} · ${money(sum(rows, r => r.total))}</span>`)
        + table({
          cols: [{ l: 'Retur no', k: 'no', w: 160 }, { l: 'Supplier', k: 'sup', w: 210 }, { l: 'Date', k: 'd', w: 80 }, { l: 'Bill', k: 'bill', w: 160 }, { l: 'Reason', k: 'why' }, { l: 'Amount', k: 'amt', num: 1, w: 150 }, { l: 'Status', k: 'st', w: 170 }],
          rows: rows.map(r => { const [w, tone] = retState(r); return { on: `openPurchaseReturn('${r.no}')`, c: { no: `<span class="nm">${r.no}</span>`, sup: `<span class="one">${esc(supName(r.sup))}</span>`, d: dayS(r.date), bill: r.bill, why: `<span class="one">${esc(r.reason)}</span>`, amt: money(r.total), st: st(w, tone) } } }),
          empty: 'No purchase return',
        })
    } else if (tab === 'recurring') {
      body = table({
        cols: [{ l: 'Template', k: 'n' }, { l: 'Paid to', k: 'to', w: 210 }, { l: 'Every', k: 'ev', w: 190 }, { l: 'Amount', k: 'amt', num: 1, w: 160 }, { l: 'Next', k: 'nx', w: 90 }, { l: '', k: 'act', cls: 'act', w: 170 }],
        rows: REC.map((t, i) => ({ on: t.last ? (t.last.startsWith('FB') ? `openBill('${t.last}')` : `openDoc('bkk','${t.last}')`) : '', c: { n: `<span class="nm">${esc(t.name)}</span>`, to: `<span class="one">${esc(t.to)}</span>`, ev: t.every, amt: money(t.amt), nx: dayS(t.next), act: btn(t.kind === 'bill' ? 'Make bill now' : 'Make BKK now', `pyRecur(${i})`, 'primary', 'ds-btn--sm cell') } })),
      })
    } else {
      const rs = loanRows(), nx = rs.find(x => x.st === 'next')
      body = `<div style="margin-bottom:24px">${facts([['Loan', LOAN.name], ['Account no', LOAN.no], ['Plafon', money(LOAN.plafon)], ['Rate', '9,75% p.a. · anuitas'], ['Tenor', `${LOAN.n} months · from ${day(LOAN.first)}`], ['Debited from', `${ACC[LOAN.acc].name} · ${ACC[LOAN.acc].no}`], ['Sisa pokok', money(loanLeft())], ['Next due', nx ? `${day(nx.due)} · ${money(nx.ang)}` : '—']])}</div>`
        + table({
          cols: [{ l: 'No', k: 'i', w: 70 }, { l: 'Due', k: 'd', w: 130 }, { l: 'Pokok', k: 'p', num: 1, w: 160 }, { l: 'Bunga', k: 'b', num: 1, w: 150 }, { l: 'Angsuran', k: 'a', num: 1, w: 160 }, { l: 'Sisa pokok', k: 's', num: 1, w: 170 }, { l: 'Status', k: 'st' }],
          rows: rs.map(x => ({ cls: x.st === 'paid' ? 'dim' : '', c: { i: String(x.i), d: day(x.due), p: money(x.pokok), b: money(x.bunga), a: money(x.ang), s: money(x.sisa), st: x.st === 'paid' ? st('Paid', 'ok') : x.st === 'next' ? st('Next', 'info') : st('Planned') } })),
          foot: { i: '', d: plural(rs.length, 'installment'), p: money(sum(rs, x => x.pokok)), b: money(sum(rs, x => x.bunga)), a: money(sum(rs, x => x.ang)) },
        })
    }
    return page({ title: 'Bills', actions: [{ label: 'Record bill', icon: 'plus', on: 'pyNewBill()' }], tabs: [['bills', 'Bills', BILLS.length], ['returns', 'Returns', RETURNS.length], ['recurring', 'Recurring', REC.length], ['loans', 'Loans', 1]], tab, kpis, body })
  },
})

function pyTick(no, on, el) {
  const xs = sel(), b = BILLS.find(x => x.no === no)
  if (on) {
    const other = xs.map(n => BILLS.find(x => x.no === n)).find(x => x.sup !== b.sup)
    if (other) { el.checked = false; toast('One supplier per BKK', `The ticked bills are for ${esc(supName(other.sup))}`, 'warn'); return }
    if (!xs.includes(no)) xs.push(no)
  } else S.sel.bills = xs.filter(n => n !== no)
  render()
}
function pyClear() { S.sel.bills = []; render() }
/* Pay: a BKK with these bills ticked. A bill already on a draft BKK opens that draft instead of paying twice. */
function pyPay(sup, nos) {
  const draft = VOUCHERS.bkk.find(v => v.st === 'draft' && v.party === sup && (v.settle || []).some(([b]) => nos.includes(b)))
  let key = 'new', d
  if (draft) { key = draft.no; d = draftOf('bkk', key) }
  else { delete DOCS.bkknew; d = draftOf('bkk', 'new'); d.party = sup; d.rows = settleRowsFor(d, null); d.acc = 'bca'; d.giro.bank = 'BCA'; d.tab = 'settle' }
  let added = 0
  d.rows.forEach(r => { if (nos.includes(r.no) && !r.pick) { r.pick = true; r.amt = r.open - r.disc; added++ } })
  S.sel.bills = []
  if (draft) toast(added ? `Added to ${draft.no}` : `Already on ${draft.no}`, 'Draft BKK · post it there')
  openDoc('bkk', key)
}

/* one bill: facts, items, the PO · receipt · bill check, what paid it, returns, activity */
function billSheet(b) {
  const s = SUP[b.sup], [w, tone] = billState(b), lunas = !isOpen(b), ls = billLines(b), tipe = tipeOf(b)
  const pays = VOUCHERS.bkk.filter(v => (v.settle || []).some(([n]) => n === b.no)).map(v => ({ v, amt: v.settle.find(([n]) => n === b.no)[1] }))
  const rets = RETURNS.filter(r => r.bill === b.no)
  const g = b.bounced && giroOfDoc(b.bounced)
  const rcv = RCV_FIX[b.no] || {}
  const banners = (b.matchIssue ? `<div class="banner bad">${ico('alert')}<span>${esc(b.matchIssue)}</span></div>` : '')
    + (g && g.state === 'bounced' && isOpen(b) ? `<div class="banner bad">${ico('alert')}<span>BG ${g.no} bounced on ${dayS(g.bounced)} — ${esc(g.why)}. The bill is open again.</span></div>` : '')
  const check = b.po ? sec('PO · receipt · bill', table({
    cols: [{ l: 'Article', k: 'a' }, { l: 'Qty PO', k: 'po', num: 1, w: 110 }, { l: 'Received', k: 'r', num: 1, w: 110 }, { l: 'Billed', k: 'b', num: 1, w: 110 }, { l: 'Left to bill', k: 'l', num: 1, w: 130 }],
    rows: ls.map((l, i) => { const got = rcv[i] ?? (b.rcv ? b.rcv[i] : l.qty), po = b.poQty ? b.poQty[i] : l.qty, left = got - l.qty; return { c: { a: artCell(l), po: num(po), r: num(got), b: left < 0 ? `<span class="bad">${num(l.qty)}</span>` : num(l.qty), l: left < 0 ? `<span class="bad">${num(left)}</span>` : left ? num(left) : '<span class="mute">0</span>' } } }),
  }), `<span class="mute">${b.po} · ${b.bpb}</span>`) : ''
  const acts = [[b.date, '', `Recorded · ${tipe}${b.bpb ? ' · ' + b.bpb : ''}`, FIN]]
  if (b.matchIssue) acts.push([b.date, '', 'Flagged to check · billed more than received', 'Central'])
  pays.forEach(({ v, amt }) => acts.push([v.date, v.time, v.st === 'draft' ? `On draft ${v.no} · ${money(amt)}` : v.st === 'void' ? `${v.no} voided` : `Paid ${money(amt)} · ${v.no}${v.method === 'giro' ? ' · BG ' + v.giro : ''}`, FIN]))
  if (g && g.state === 'bounced') acts.push([g.bounced, '', `BG ${g.no} bounced · ${g.why}`, FIN])
  rets.forEach(r => acts.push([r.date, '', `Return ${r.no} · ${money(r.total)}`, FIN]))
  acts.sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1]))
  return {
    size: 'record', crumb: ['Bills', s.name], title: b.no, pill: `${pill(w, tone)}${lunas ? pill('READ ONLY', 'ro') : ''}`,
    body: `${banners}${kpisHTML([{ label: 'Total', value: money(b.total) }, { label: 'PPN in it', value: money(ppnOf(b)) }, { label: 'Paid', value: money(b.paid) }, { label: 'Left', value: money(billLeft(b)), tone: overdue(b) ? 'bad' : '' }])}
      <div style="margin:24px 0 28px">${facts([['Supplier', `<button class="lnk" type="button" style="height:auto;padding:0;margin:0" onclick="openSupplier('${b.sup}')">${esc(s.name)}</button>`], ['Supplier invoice no', esc(b.inv)], ['Date', day(b.date)], ['Due', overdue(b) ? `<span class="bad">${day(b.due)}</span>` : day(b.due)], ['Term', `${daysBetween(b.date, b.due)} days`], ['PO', b.po || '—'], ['Receipt (BPB)', b.bpb || '—'], ['Tipe', tipe], ['Lokasi', b.nonstock ? 'HO' : 'HO · Gudang']])}</div>
      ${sec('Items', table({
        cols: [{ l: 'Kode', k: 'k', w: 150 }, { l: 'Article', k: 'a' }, { l: 'Qty', k: 'q', num: 1, w: 90 }, { l: 'Unit price', k: 'p', num: 1, w: 150 }, { l: 'Discount', k: 'd', num: 1, w: 120 }, { l: 'Subtotal', k: 's', num: 1, w: 160 }],
        rows: ls.map(l => ({ c: { k: kodeCell(l), a: artCell(l), q: num(l.qty), p: money(l.price), d: l.disc ? money(-l.disc) : DASH, s: money(l.sub) } })),
        foot: { k: '', a: plural(ls.length, 'line'), q: num(sum(ls, l => l.qty)), s: money(b.total) },
      }))}
      ${check}
      ${sec('Payments', table({
        cols: [{ l: 'Date', k: 'd', w: 90 }, { l: 'BKK', k: 'no', w: 190 }, { l: 'Paid by', k: 'by' }, { l: 'Amount', k: 'amt', num: 1, w: 160 }, { l: 'Status', k: 'st', w: 160 }],
        rows: pays.map(({ v, amt }) => { const [vw, vt] = voucherState('bkk', v), bad = vt === 'bad'; return { cls: v.st === 'void' ? 'dim' : '', on: `openDoc('bkk','${v.no}')`, c: { d: dayS(v.date), no: `<span class="nm">${v.no}</span>`, by: `${ACC[v.acc].name}${v.method === 'giro' ? ` · BG ${v.giro}` : ` · ${METHOD[v.method]}`}`, amt: bad ? `<span class="bad">${money(amt)}</span>` : money(amt), st: st(vw, vt) } } }),
        empty: 'Not paid yet',
      }))}
      ${rets.length ? sec('Returns', table({
        cols: [{ l: 'Retur no', k: 'no', w: 180 }, { l: 'Date', k: 'd', w: 90 }, { l: 'Reason', k: 'why' }, { l: 'Amount', k: 'amt', num: 1, w: 160 }, { l: 'Status', k: 'st', w: 180 }],
        rows: rets.map(r => { const [rw, rt] = retState(r); return { on: `openPurchaseReturn('${r.no}')`, c: { no: `<span class="nm">${r.no}</span>`, d: dayS(r.date), why: esc(r.reason), amt: money(r.total), st: st(rw, rt) } } }),
      })) : ''}
      ${sec('Activity', table({
        cols: [{ l: 'When', k: 'w', w: 150 }, { l: 'What', k: 'x' }, { l: 'By', k: 'by', w: 200 }],
        rows: acts.map(([d, t, x, by]) => ({ c: { w: `${dayS(d)}${t ? ' · ' + t : ''}`, x: `<span class="one">${esc(x)}</span>`, by: esc(by) } })),
      }))}`,
    foot: `<div class="foot-left">${lnk('Print', `soon('Print ${b.no}')`, 'printer')}${b.po ? lnk('Return goods', `pyReturnForm('${b.no}')`, 'undo') : ''}</div>${lunas ? '' : btn('Pay', `pyPay('${b.sup}',['${b.no}'])`)}`,
  }
}
function openBill(no) { const b = BILLS.find(x => x.no === no); if (b) openSheet(billSheet(b)) }

/* ── Record bill: supplier → its receipts → items prefilled from the PO, Qty billed editable ── */
let BF = null
const BF_REASONS = ['PPN 12% · DPP 11/12', 'Non-PPN']
function bfPickRc(code) {
  const rc = RCPT.find(r => r.sup === code && !r.billed)
  BF.rc = rc ? rc.bpb : ''
  BF.tipe = rc ? 'MATCHING' : 'STANDARD'
  BF.qty = rc ? rc.lines.map(l => l[2]) : []
}
function pyNewBill(pre) {
  BF = { sup: '', inv: '', date: TODAY, rc: '', tipe: 'STANDARD', ppn: 'ppn', note: '', qty: [], free: [], adv: 0, tried: false }
  if (pre) Object.assign(BF, pre)
  else if (S.id === 'bills' && filt('bills', 'sup', 'all') !== 'all') { BF.sup = filt('bills', 'sup'); bfPickRc(BF.sup) }
  openSheet(billForm())
}
const bfRc = () => RCPT.find(r => r.bpb === BF.rc)
function bfTotals() {
  const rc = bfRc()
  const total = BF.tipe === 'UANG MUKA' ? BF.adv : BF.tipe === 'MATCHING' && rc ? sum(rc.lines, (l, i) => (BF.qty[i] || 0) * l[3]) : sum(BF.free, l => Math.round((l.qty || 0) * (l.price || 0)))
  const ppn = BF.ppn === 'ppn' ? total - Math.round(total * 100 / 111) : 0
  return { total, ppn, dpp: total - ppn }
}
function bfProblems() {
  const p = []
  if (!BF.sup) p.push('Supplier')
  if (!BF.inv.trim()) p.push('Supplier invoice no')
  if (!BF.date) p.push('Date')
  else if (BF.date < '2026-10-01') p.push('September is closed')
  if (bfTotals().total <= 0) p.push('Nothing billed yet')
  return p
}
function billForm() {
  const s = SUP[BF.sup], rcs = RCPT.filter(r => r.sup === BF.sup && !r.billed), rc = bfRc(), t = bfTotals(), p = BF.tried ? bfProblems() : []
  const err = k => p.includes(k) ? 'err' : ''
  const over = rc && BF.tipe === 'MATCHING' ? rc.lines.map((l, i) => (BF.qty[i] || 0) > l[2] ? `${typeof l[0] === 'number' ? ARTICLES[l[0]][1] : l[0]} ${num(BF.qty[i])} of ${num(l[2])}` : '').filter(Boolean) : []
  const due = s && BF.date ? `${s.term} days · due ${day(addDays(BF.date, s.term))}` : ''
  const fields = `<div class="form-grid">
    ${field('Supplier', `<select onchange="pyBf('sup',this.value)"><option value="">Pick a supplier</option>${SUPPLIERS.map(x => `<option value="${x.code}" ${x.code === BF.sup ? 'selected' : ''}>${esc(x.name)} · ${x.code}</option>`).join('')}</select>`, { req: 1, cls: 's2 ' + err('Supplier') })}
    ${field('Supplier invoice no', `<input data-f="inv" value="${esc(BF.inv)}" placeholder="INV/…" oninput="BF_set('inv',this.value)">`, { req: 1, cls: err('Supplier invoice no') })}
    ${field('Date', `<input type="date" value="${BF.date}" max="${TODAY}" onchange="pyBf('date',this.value)">`, { req: 1, cls: err('Date') })}
    ${field('PO / Receipt', `<select ${BF.sup ? '' : 'disabled'} onchange="pyBf('rc',this.value)"><option value="">No PO</option>${rcs.map(r => `<option value="${r.bpb}" ${r.bpb === BF.rc ? 'selected' : ''}>${r.po} · ${r.bpb} · ${dayS(r.date)}</option>`).join('')}</select>`, { cls: 's2' })}
    ${field('Tipe', `<select onchange="pyBf('tipe',this.value)">${['MATCHING', 'STANDARD', 'UANG MUKA'].map(x => `<option ${x === BF.tipe ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}
    ${field('Term', `<input value="${due}" placeholder="From the supplier" readonly>`)}
    ${field('PPN code', `<select onchange="pyBf('ppn',this.value)"><option value="ppn" ${BF.ppn === 'ppn' ? 'selected' : ''}>${BF_REASONS[0]}</option><option value="non" ${BF.ppn === 'non' ? 'selected' : ''}>${BF_REASONS[1]}</option></select>`, { cls: 's2' })}
  </div>`
  let grid
  if (BF.tipe === 'UANG MUKA') grid = `<div class="form-grid">${field('Advance amount', `<input inputmode="numeric" data-f="adv" value="${BF.adv ? dots(BF.adv) : ''}" placeholder="0" oninput="pyBfAdv(this)">`, { req: 1, cls: 's2' })}</div>`
  else if (BF.tipe === 'MATCHING' && rc) grid = `<div class="kl-grid"><table><colgroup><col style="width:150px"><col><col style="width:100px"><col style="width:110px"><col style="width:130px"><col style="width:140px"><col style="width:160px"></colgroup>
    <thead><tr><th>Kode</th><th>Article</th><th class="r">Qty PO</th><th class="r">Received</th><th class="r">Qty billed</th><th class="r">Unit price</th><th class="r">Subtotal</th></tr></thead><tbody>
    ${rc.lines.map((l, i) => { const art = typeof l[0] === 'number' ? ARTICLES[l[0]] : null, q = BF.qty[i] || 0; return `<tr class="${q > l[2] ? 'over' : ''}"><td>${art ? sku(art[0], 101 + (l[0] * 3 + i) % 8) : DASH}</td><td>${art ? `<span class="nm">${esc(art[1])}</span> <span class="mute">${art[0]}</span>` : esc(l[0])}</td><td class="r">${num(l[1])}</td><td class="r">${num(l[2])}</td>
      <td class="cellin r pay"><input inputmode="numeric" data-f="q${i}" value="${q ? dots(q) : ''}" placeholder="0" oninput="pyBfQty(${i},this)"></td><td class="r">${dots(l[3])}</td><td class="r" data-o="s${i}">${dots(q * l[3])}</td></tr>` }).join('')}
    </tbody><tfoot><tr><td></td><td>${plural(rc.lines.length, 'line')}</td><td class="r">${num(sum(rc.lines, l => l[1]))}</td><td class="r">${num(sum(rc.lines, l => l[2]))}</td><td class="r" data-o="qsum">${num(sum(BF.qty))}</td><td></td><td class="r" data-o="tsum">${dots(t.total)}</td></tr></tfoot></table></div>`
  else {
    const rows = [...BF.free, { desc: '', qty: 0, price: 0, blank: true }]
    grid = `<div class="kl-grid"><table><colgroup><col style="width:48px"><col><col style="width:110px"><col style="width:170px"><col style="width:170px"></colgroup>
    <thead><tr><th></th><th>Uraian</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Subtotal</th></tr></thead><tbody>
    ${rows.map((l, i) => `<tr class="${l.blank ? 'blank' : ''}"><td class="mute" style="text-align:center">${l.blank ? ico('plus') : i + 1}</td>
      <td class="cellin"><input data-f="d${i}" value="${esc(l.desc)}" placeholder="${l.blank ? 'Type what is billed' : ''}" oninput="pyBfFree(${i},'desc',this.value)"></td>
      <td class="cellin r"><input inputmode="numeric" data-f="n${i}" value="${l.qty ? dots(l.qty) : ''}" placeholder="0" oninput="pyBfFree(${i},'qty',this.value)"></td>
      <td class="cellin r"><input inputmode="numeric" data-f="p${i}" value="${l.price ? dots(l.price) : ''}" placeholder="0" oninput="pyBfFree(${i},'price',this.value)"></td>
      <td class="r" data-o="f${i}">${l.blank ? '' : dots(Math.round(l.qty * l.price))}</td></tr>`).join('')}
    </tbody><tfoot><tr><td></td><td>${plural(BF.free.length, 'line')}</td><td></td><td></td><td class="r" data-o="tsum">${dots(t.total)}</td></tr></tfoot></table></div>`
  }
  const strip = `<div class="ds-kpis kpis" style="margin-top:20px"><div class="ds-kpi"><div class="ds-kpi-label">DPP</div><div class="ds-kpi-value" data-o="dpp">${money(t.dpp)}</div></div><div class="ds-kpi"><div class="ds-kpi-label">PPN</div><div class="ds-kpi-value" data-o="ppn">${money(t.ppn)}</div></div><div class="ds-kpi"><div class="ds-kpi-label">Total</div><div class="ds-kpi-value" data-o="tot">${money(t.total)}</div></div></div>`
  const banner = (p.length ? `<div class="banner bad">${ico('alert')}<span>${plural(p.length, 'thing')} to fix: ${p.map(esc).join(' · ')}</span></div>` : '')
    + (over.length ? `<div class="banner warn">${ico('alert')}<span>Billed more than received: ${over.map(esc).join(' · ')}. It saves as To check.</span></div>` : '')
  return {
    size: 'wide', crumb: ['Bills'], title: 'Record bill', pill: pill(nextNo(BILLS, 'FB/HO/2610/'), 'info'),
    body: `${banner}${fields}<div style="height:28px"></div>${grid}${strip}<div class="form-grid" style="margin-top:24px">${field('Note', `<input data-f="note" value="${esc(BF.note)}" placeholder="Printed on the bill" oninput="BF_set('note',this.value)">`, { cls: 's4' })}</div>`,
    foot: btn('Save bill', 'pyBfSave()'),
  }
}
function BF_set(k, v) { BF[k] = v }
function pyBf(k, v) {
  if (k === 'sup') { BF.sup = v; BF.free = []; bfPickRc(v) }
  else if (k === 'rc') { BF.rc = v; const rc = bfRc(); BF.tipe = rc ? 'MATCHING' : BF.tipe === 'MATCHING' ? 'STANDARD' : BF.tipe; BF.qty = rc ? rc.lines.map(l => l[2]) : [] }
  else if (k === 'tipe') { BF.tipe = v; if (v === 'MATCHING' && !bfRc()) bfPickRc(BF.sup) }
  else BF[k] = v
  refreshSheet(billForm())
}
function bfOuts() {
  const t = bfTotals(), set = (k, v) => { const el = sheetEl(`[data-o="${k}"]`); if (el) el.textContent = v }
  set('dpp', money(t.dpp)); set('ppn', money(t.ppn)); set('tot', money(t.total)); set('tsum', dots(t.total)); set('qsum', num(sum(BF.qty)))
}
function pyBfQty(i, el) {
  const rc = bfRc(), l = rc.lines[i]
  BF.qty[i] = parseRp(el.value)
  el.closest('tr').classList.toggle('over', BF.qty[i] > l[2])
  const s = sheetEl(`[data-o="s${i}"]`); if (s) s.textContent = dots(BF.qty[i] * l[3])
  bfOuts()
}
function pyBfAdv(el) { BF.adv = parseRp(el.value); bfOuts() }
function pyBfFree(i, k, v) {
  let fresh = false
  if (i >= BF.free.length) { BF.free.push({ desc: '', qty: 1, price: 0 }); fresh = true }
  const l = BF.free[i]
  l[k] = k === 'desc' ? v : parseRp(v)
  if (fresh) { refreshSheet(billForm()); refocus(`[data-f="${k === 'desc' ? 'd' : k === 'qty' ? 'n' : 'p'}${i}"]`); return }
  const s = sheetEl(`[data-o="f${i}"]`); if (s) s.textContent = dots(Math.round(l.qty * l.price))
  bfOuts()
}
function pyBfSave() {
  BF.tried = true
  if (bfProblems().length) { refreshSheet(billForm()); return }
  const s = SUP[BF.sup], rc = bfRc(), t = bfTotals(), no = nextNo(BILLS, 'FB/HO/2610/')
  const matching = BF.tipe === 'MATCHING' && rc
  const ls = BF.tipe === 'UANG MUKA' ? [[`Uang muka ${rc ? rc.po : ''}`.trim(), 1, BF.adv]] : matching ? rc.lines.map((l, i) => [l[0], BF.qty[i] || 0, l[3]]).filter(l => l[1]) : BF.free.filter(l => l.qty && l.price).map(l => [l.desc || 'Tanpa uraian', l.qty, l.price])
  const keep = matching ? rc.lines.map((l, i) => i).filter(i => BF.qty[i]) : []
  const overI = matching ? keep.findIndex(i => BF.qty[i] > rc.lines[i][2]) : -1
  const b = {
    no, inv: BF.inv.trim(), sup: BF.sup, date: BF.date, due: addDays(BF.date, s.term), po: rc ? rc.po : null, bpb: rc ? rc.bpb : null, total: t.total, paid: 0, lines: ls, tipe: BF.tipe, note: BF.note, nonPpn: BF.ppn === 'non',
    nonstock: !ls.some(l => typeof l[0] === 'number') || undefined, rcv: matching ? keep.map(i => rc.lines[i][2]) : undefined, poQty: matching ? keep.map(i => rc.lines[i][1]) : undefined,
  }
  if (overI >= 0) { const i = keep[overI], l = rc.lines[i]; b.matchIssue = `Invoiced ${num(BF.qty[i])} of ${typeof l[0] === 'number' ? ARTICLES[l[0]][1] : l[0]}; received ${num(l[2])}` }
  BILLS.unshift(b)
  if (rc) rc.billed = true
  W.PAL_DOCS.push({ doc: 1, t: `${no} · ${s.name}`, g: 'Bills', go: () => { go('bills'); setTimeout(() => openBill(no), 30) } })
  toast(`${no} saved`, `${money(t.total)} · due ${dayS(b.due)}${b.matchIssue ? ' · To check' : ''}`, b.matchIssue ? 'warn' : 'ok')
  closeSheet(); render()
  setTimeout(() => openBill(no), 230)
}

/* ── purchase returns (Invoice Retur Beli) ── */
function returnSheet(r) {
  const [w, tone] = retState(r), ls = billLines({ no: '', total: r.total, lines: r.lines })
  return {
    size: 'wide', crumb: ['Bills', 'Returns'], title: r.no, pill: pill(w, tone),
    body: `<div style="margin-bottom:28px">${facts([['Supplier', esc(supName(r.sup))], ['Date', day(r.date)], ['Bill', `<button class="lnk" type="button" style="height:auto;padding:0" onclick="openBill('${r.bill}')">${r.bill}</button>`], ['Reason', esc(r.reason)], ['Settles by', r.offsetNext ? 'Offset next payment' : 'Refund by BKM'], ['Refund', r.refundBy ? `<button class="lnk" type="button" style="height:auto;padding:0" onclick="openDoc('bkm','${r.refundBy}')">${r.refundBy}</button>` : '—'], ['Amount', money(r.total)], ['PPN in it', money(r.total - Math.round(r.total * 100 / 111))]])}</div>
      ${sec('Items', table({
        cols: [{ l: 'Kode', k: 'k', w: 150 }, { l: 'Article', k: 'a' }, { l: 'Qty', k: 'q', num: 1, w: 90 }, { l: 'Unit price', k: 'p', num: 1, w: 150 }, { l: 'Subtotal', k: 's', num: 1, w: 160 }],
        rows: ls.map(l => ({ c: { k: kodeCell(l), a: artCell(l), q: num(l.qty), p: money(l.price), s: money(l.sub) } })),
        foot: { a: plural(ls.length, 'line'), q: num(sum(ls, l => l.qty)), s: money(r.total) },
      }))}`,
    foot: `<div class="foot-left">${lnk('Print retur', `soon('Print ${r.no}')`, 'printer')}</div>${!r.refundBy && !r.offsetNext ? btn('Record refund', `pyRefund('${r.no}')`) : ''}`,
  }
}
function openPurchaseReturn(no) { const r = RETURNS.find(x => x.no === no); if (r) openSheet(returnSheet(r)) }
function pyRefund(no) {
  const r = RETURNS.find(x => x.no === no)
  delete DOCS.bkmnew
  const d = draftOf('bkm', 'new')
  d.party = r.sup; d.offs = offsetRowsFor(d, null); d.acc = 'bca'; d.tab = 'offset'; d.note = `Refund retur ${r.no}`
  d.offs.forEach(x => { if (x.no === no) { x.pick = true; x.amt = x.open } })
  openDoc('bkm', 'new')
}
let RF = null
const RF_REASONS = ['Reject · jahitan lepas', 'Reject · cacat produksi', 'Over delivery', 'Salah artikel', 'Salah ukuran']
function pyReturnForm(billNo) { RF = { bill: billNo, date: TODAY, reason: RF_REASONS[0], how: 'refund', qty: [], tried: false }; openSheet(returnForm()) }
function rfLines() {
  const b = BILLS.find(x => x.no === RF.bill), ls = billLines(b)
  const before = RETURNS.filter(r => r.bill === b.no)
  return ls.map(l => { const back = sum(before, r => sum(r.lines.filter(x => x[0] === l.a), x => x[1])); return { ...l, back, max: l.qty - back } })
}
const rfTotal = () => sum(rfLines(), (l, i) => Math.round((RF.qty[i] || 0) * l.price))
function returnForm() {
  const b = BILLS.find(x => x.no === RF.bill), ls = rfLines(), tot = rfTotal()
  const p = RF.tried ? [...(tot <= 0 ? ['Nothing to return yet'] : []), ...ls.filter((l, i) => (RF.qty[i] || 0) > l.max).map(l => `${l.desc}: only ${num(l.max)} can go back`)] : []
  return {
    size: 'wide', crumb: ['Bills', b.no], title: 'Return goods', pill: pill(nextNo(RETURNS, 'RB/HO/2610/'), 'info'),
    body: `${p.length ? `<div class="banner bad">${ico('alert')}<span>${p.map(esc).join(' · ')}</span></div>` : ''}<div class="form-grid">
      ${field('Bill', `<input value="${b.no}" readonly>`)}${field('Supplier', `<input value="${esc(supName(b.sup))}" readonly>`)}
      ${field('Date', `<input type="date" value="${RF.date}" max="${TODAY}" onchange="RF.date=this.value">`, { req: 1 })}
      ${field('Reason', `<select onchange="RF.reason=this.value">${RF_REASONS.map(x => `<option ${x === RF.reason ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`)}
      <div class="f7 s2"><span>Settle</span><div class="seg" role="radiogroup">${[['refund', 'Refund by BKM'], ['offset', 'Offset next payment']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${RF.how === k}" onclick="RF.how='${k}';refreshSheet(returnForm())">${l}</button>`).join('')}</div></div>
    </div><div style="height:28px"></div>
    <div class="kl-grid"><table><colgroup><col style="width:150px"><col><col style="width:90px"><col style="width:110px"><col style="width:140px"><col style="width:140px"><col style="width:160px"></colgroup>
      <thead><tr><th>Kode</th><th>Article</th><th class="r">Billed</th><th class="r">Returned</th><th class="r">Qty to return</th><th class="r">Unit price</th><th class="r">Subtotal</th></tr></thead><tbody>
      ${ls.map((l, i) => { const q = RF.qty[i] || 0; return `<tr class="${q > l.max ? 'over' : ''}"><td>${kodeCell(l)}</td><td>${artCell(l)}</td><td class="r">${num(l.qty)}</td><td class="r">${l.back ? num(l.back) : '<span class="mute">0</span>'}</td>
        <td class="cellin r pay"><input inputmode="numeric" value="${q ? dots(q) : ''}" placeholder="0" oninput="pyRfQty(${i},this)"></td><td class="r">${dots(l.price)}</td><td class="r" data-o="r${i}">${q ? dots(Math.round(q * l.price)) : ''}</td></tr>` }).join('')}
      </tbody><tfoot><tr><td></td><td>${plural(ls.length, 'line')}</td><td></td><td></td><td></td><td></td><td class="r" data-o="rtot">${dots(tot)}</td></tr></tfoot></table></div>`,
    foot: btn('Save return', 'pyRfSave()'),
  }
}
function pyRfQty(i, el) {
  const l = rfLines()[i]
  RF.qty[i] = parseRp(el.value)
  el.closest('tr').classList.toggle('over', RF.qty[i] > l.max)
  const s = sheetEl(`[data-o="r${i}"]`); if (s) s.textContent = RF.qty[i] ? dots(Math.round(RF.qty[i] * l.price)) : ''
  const t = sheetEl('[data-o="rtot"]'); if (t) t.textContent = dots(rfTotal())
}
function pyRfSave() {
  RF.tried = true
  const ls = rfLines(), tot = rfTotal()
  if (tot <= 0 || ls.some((l, i) => (RF.qty[i] || 0) > l.max)) { refreshSheet(returnForm()); return }
  const b = BILLS.find(x => x.no === RF.bill), no = nextNo(RETURNS, 'RB/HO/2610/')
  RETURNS.unshift({ no, sup: b.sup, date: RF.date, bill: b.no, reason: RF.reason, total: tot, refundBy: null, offsetNext: RF.how === 'offset', lines: ls.map((l, i) => [l.a, RF.qty[i] || 0, l.price]).filter(l => l[1]) })
  W.PAL_DOCS.push({ doc: 1, t: `${no} · ${supName(b.sup)}`, g: 'Bills › Returns', go: () => { go('bills', 'returns'); setTimeout(() => openPurchaseReturn(no), 30) } })
  toast(`${no} saved`, `${money(tot)} · ${RF.how === 'offset' ? 'offsets the next payment' : 'waits for the refund'}`)
  closeSheet(); render()
  setTimeout(() => refreshSheet(billSheet(b)), 230)
}

/* ── recurring: a bill template opens Record bill; a BKK template opens a prefilled BKK ── */
function pyRecur(i) {
  const t = REC[i]
  if (t.kind === 'bill') return pyNewBill({ sup: t.sup, tipe: 'STANDARD', free: [{ desc: t.line, qty: 1, price: t.amt }] })
  delete DOCS.bkknew
  const d = draftOf('bkk', 'new')
  d.party = null; d.rows = []; d.acc = t.acc; d.giro.bank = ACC[t.acc].bank || ''; d.ref = t.ref; d.note = t.note; d.tab = 'other'
  d.other = [{ acc: t.other[0], note: t.other[1], amt: t.amt }]
  openDoc('bkk', 'new')
}
function pyGiro(no) { go('giro'); setTimeout(() => W.openGiro && W.openGiro(no), 30) }

/* ═════════ Payables › Suppliers ═════════ */
function supRow(s) {
  const open = BILLS.filter(b => b.sup === s.code && isOpen(b)), gi = GIROS.filter(g => g.sup === s.code && GIRO_OUT(g))
  return { s, open, owed: sum(open, billLeft), od: sum(open.filter(overdue), billLeft), wk: sum(open.filter(dueWeek), billLeft), next: open.map(b => b.due).sort()[0], giro: sum(gi, g => g.amt), giroN: gi.length, paid: lastPaid(s.code) }
}
reg({
  id: 'suppliers', group: 'pay', label: 'Suppliers',
  s7: [['Info Pembelian'], ['Kartu Hutang'], ['Summary Hutang'], ['Umur Hutang'], ['Supplier']],
  render() {
    const id = 'suppliers', f = filt(id, 'st', 'all'), all = SUPPLIERS.map(supRow)
    const gOut = GIROS.filter(GIRO_OUT)
    const kpis = [
      { label: 'Owed', value: money(sum(all, r => r.owed)), on: `setFilt('${id}','st','owing')` },
      { label: 'Overdue', value: money(sum(all, r => r.od)), tone: sum(all, r => r.od) ? 'bad' : '', on: `setFilt('${id}','st','overdue')` },
      { label: 'Due this week', value: money(sum(all, r => r.wk)) },
      { label: 'Giro still out', value: `${gOut.length} · ${money(sum(gOut, g => g.amt))}`, on: "go('giro')" },
    ]
    const pass = r => f === 'all' || (f === 'owing' ? r.owed > 0 : f === 'overdue' ? r.od > 0 : r.giro > 0)
    const rows = all.filter(pass).filter(r => hit(S.q[id], r.s.name, r.s.code, r.s.city, r.s.contact)).sort((x, y) => y.owed - x.owed || x.s.name.localeCompare(y.s.name))
    const n = k => all.filter(r => k === 'owing' ? r.owed > 0 : k === 'overdue' ? r.od > 0 : r.giro > 0).length
    const body = bar(chips(id, 'st', [['all', 'All', all.length], ['owing', 'Owing', n('owing')], ['overdue', 'Overdue', n('overdue'), 'clock'], ['giro', 'Giro out', n('giro')]], 'all'), search(id, 'Supplier, code, city or contact'))
      + table({
        cols: [{ l: 'Supplier', k: 'n' }, { l: 'Term', k: 't', w: 90 }, { l: 'Owed', k: 'o', num: 1, w: 160 }, { l: 'Overdue', k: 'od', num: 1, w: 160 }, { l: 'Next due', k: 'nx', w: 100 }, { l: 'Giro out', k: 'g', num: 1, w: 160 }, { l: 'Last paid', k: 'lp', w: 100 }],
        rows: rows.map(r => ({ on: `openSupplier('${r.s.code}')`, c: { n: `<span class="nm">${esc(r.s.name)}</span> <span class="mute">${r.s.code}</span>`, t: `${r.s.term} days`, o: r.owed ? money(r.owed) : DASH, od: r.od ? `<span class="bad">${money(r.od)}</span>` : DASH, nx: r.next ? (r.next < TODAY ? `<span class="bad">${dayS(r.next)}</span>` : dayS(r.next)) : DASH, g: r.giro ? money(r.giro) : DASH, lp: r.paid ? dayS(r.paid) : DASH } })),
        foot: { n: plural(rows.length, 'supplier'), o: money(sum(rows, r => r.owed)), od: money(sum(rows, r => r.od)), g: money(sum(rows, r => r.giro)) },
        empty: 'No supplier matches',
      })
    return page({ title: 'Suppliers', kpis, body })
  },
})
function openSupplier(code) {
  const s = SUP[code], r = supRow(s), open = r.open.slice().sort((x, y) => x.due.localeCompare(y.due)), k = kartuHutang(code)
  const age = [0, 0, 0, 0, 0]
  open.forEach(b => { const late = daysBetween(b.due, TODAY); age[late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4] += billLeft(b) })
  const due = open.filter(b => b.due <= addDays(TODAY, 7)), pay = (due.length ? due : open).map(b => `'${b.no}'`).join(',')
  openSheet({
    size: 'record', crumb: ['Suppliers', s.code], title: esc(s.name), pill: r.od ? pill('Overdue', 'bad') : '',
    body: `${kpisHTML([{ label: 'Owed', value: money(r.owed) }, { label: 'Overdue', value: money(r.od), tone: r.od ? 'bad' : '' }, { label: 'Giro out', value: `${r.giroN} · ${money(r.giro)}` }, { label: 'Limit', value: money(s.limit), tone: r.owed > s.limit ? 'bad' : '' }])}
      <div style="height:28px"></div>
      ${sec('Aging', kpisHTML([['Not due', 0], ['1–30 days', 1], ['31–60 days', 2], ['61–90 days', 3], ['90+ days', 4]].map(([l, i]) => ({ label: l, value: money(age[i]), tone: i && age[i] ? 'bad' : '' }))))}
      ${sec('Open bills', table({
        cols: [{ l: 'Bill', k: 'no' }, { l: 'Date', k: 'd', w: 90 }, { l: 'Due', k: 'du', w: 90 }, { l: 'Amount', k: 'a', num: 1, w: 160 }, { l: 'Left', k: 'l', num: 1, w: 160 }, { l: 'Status', k: 'st', w: 160 }],
        rows: open.map(b => { const [w, tone] = billState(b); return { on: `openBill('${b.no}')`, c: { no: `<span class="nm">${b.no}</span>`, d: dayS(b.date), du: overdue(b) ? `<span class="bad">${dayS(b.due)}</span>` : dayS(b.due), a: money(b.total), l: money(billLeft(b)), st: st(w, tone) } } }),
        foot: open.length ? { no: plural(open.length, 'bill'), a: money(sum(open, b => b.total)), l: money(r.owed) } : null,
        empty: 'Nothing owed',
      }))}
      ${sec('Kartu hutang', table({
        cols: [{ l: 'Date', k: 'd', w: 90 }, { l: 'Document', k: 'doc' }, { l: 'Debit', k: 'dr', num: 1, w: 160 }, { l: 'Credit', k: 'cr', num: 1, w: 160 }, { l: 'Balance', k: 'b', num: 1, w: 170 }],
        rows: [{ cls: 'dim', c: { d: '1 Oct', doc: 'Saldo awal', b: money(k.open) } }, ...k.rows.map(l => ({ on: l.on, c: { d: dayS(l.date), doc: `<span class="one"><span class="nm">${esc(l.no)}</span>${l.ref ? ` <span class="mute">· ${esc(l.ref)}</span>` : ''}</span>`, dr: l.dr ? money(l.dr) : '', cr: l.cr ? money(l.cr) : '', b: money(l.bal) } }))],
        foot: { d: '', doc: plural(k.rows.length, 'line'), dr: money(sum(k.rows, l => l.dr)), cr: money(sum(k.rows, l => l.cr)), b: money(k.close) },
      }), `<span class="mute">${dayS('2026-10-01')} – ${dayS(TODAY)}</span>`)}
      ${facts([['Kode', s.code], ['NPWP', s.npwp], ['Bank account', esc(s.bank)], ['City', esc(s.city)], ['Contact', esc(s.contact)], ['Term', `${s.term} days`]])}`,
    foot: `<div class="foot-left">${lnk('Print kartu', `soon('Kartu hutang ${esc(s.name)}')`, 'printer')}</div>${open.length ? btn(due.length ? `Pay due bills · ${due.length}` : 'Pay open bills', `pyPay('${code}',[${pay}])`) : ''}`,
  })
}

/* ═════════ Accounting › Journal ═════════ */
const JREC = [
  { name: 'Amortisasi sewa C011 Sipin', every: 'Monthly · 1st', amt: 15000000, next: '2026-11-01', last: null, ref: 'BKK/HO/2610/0050', note: 'Amortisasi sewa dibayar dimuka C011 Sipin, November', lines: () => [['7010110003', '11', 'Sewa toko November', 15000000, 0], ['1011301003', '11', 'Amortisasi 1 dari 3', 0, 15000000]] },
  { name: 'Balik accrual listrik YMHD', every: 'Monthly · 1st', amt: ACCR_SUM, next: '2026-11-01', last: 'JU/HO/2610/0031', ref: 'JU/HO/2610/0035', note: 'Balik accrual listrik YMHD Oktober', lines: () => accrLines('Oktober', true) },
  { name: 'Accrual listrik YMHD · 14 lokasi', every: 'Monthly · 28th', amt: ACCR_SUM, next: '2026-11-28', last: 'JU/HO/2610/0035', ref: 'YMHD-LISTRIK-2611', note: 'Accrual listrik YMHD · pemakaian November, tagihan Desember', lines: () => accrLines('November') },
  { name: 'Penyusutan & amortisasi aktiva', every: 'Monthly · from Assets', amt: () => sum(deprRun(), l => l[3]), next: '2026-11-30', last: () => (allJ().find(j => j.auto) || {}).no || null, ref: 'Assets · Oktober 2026', note: 'Penyusutan & amortisasi aktiva, Oktober 2026', lines: deprRun },
]
const SRCS = ['Daily close', 'BKK', 'BKM', 'Bill', 'Giro', 'Depreciation', 'Manual']
const capRows = (key, rows, n = 200) => S.f[key + '_all'] || rows.length <= n ? { rows, more: '' } : { rows: rows.slice(0, n), more: `<div class="note-line">${lnk(`Show all ${dots(rows.length)} lines`, `S.f['${key}_all']=1;render()`, 'chevron-down')}</div>` }
reg({
  id: 'journal', group: 'acc', label: 'Journal',
  badge: () => { bumpJu(); return null },
  s7: [['Transaksi Jurnal'], ['All Jurnal', 'all'], ['Jurnal Berulang', 'recurring']],
  render() {
    const id = 'journal', tab = tabOf(id, 'jurnal')
    const oct = lines().filter(l => l.date >= '2026-10-01')
    let body
    if (tab === 'jurnal') {
      const js = allJ(), f = filt(id, 'st', 'all'), n = k => js.filter(j => stOf(j) === k).length
      const rows = js.filter(j => f === 'all' || stOf(j) === f).filter(j => hit(S.q[id], j.no, j.ref, j.note))
      body = bar(chips(id, 'st', [['all', 'All', js.length], ['posted', 'Posted', n('posted')], ['reversed', 'Reversed', n('reversed')], ['reversal', 'Reversal', n('reversal')]], 'all'), search(id, 'Jurnal no, referensi or keterangan'), spacer, '<span class="bar-count">October 2026</span>')
        + table({
          cols: [{ l: 'No Jurnal', k: 'no', w: 180 }, { l: 'Tanggal', k: 'd', w: 90 }, { l: 'No Referensi', k: 'ref', w: 190 }, { l: 'Keterangan', k: 'k' }, { l: 'Total', k: 't', num: 1, w: 160 }, { l: 'Status', k: 'st', w: 140 }],
          rows: rows.map(j => ({ cls: stOf(j) === 'reversed' ? 'dim' : '', on: `openJournal('${j.no}')`, c: { no: `<span class="nm">${j.no}</span>`, d: dayS(j.date), ref: `<span class="one">${esc(j.ref)}</span>`, k: `<span class="one">${esc(j.note)}</span>`, t: money(jTotal(j)), st: st(...JST[stOf(j)]) } })),
          foot: { no: plural(rows.length, 'jurnal'), t: money(sum(rows, jTotal)) },
          empty: 'No jurnal matches',
        })
    } else if (tab === 'all') {
      const f = filt(id, 'src', 'all'), qq = S.q[id + 'a']
      const list = oct.filter(l => f === 'all' || l.src === f).filter(l => hit(qq, l.no, l.code, nameOf(l.code.slice(0, 10)), l.what)).sort((x, y) => y.date.localeCompare(x.date) || x.no.localeCompare(y.no))
      const { rows, more } = capRows('jall' + f, list)
      body = bar(chips(id, 'src', [['all', 'All', oct.length], ...SRCS.map(s => [s, s, oct.filter(l => l.src === s).length])], 'all'), `<label class="ds-search">${ico('search')}<input type="search" placeholder="No, account or name" value="${esc(qq || '')}" oninput="S.q['${id}a']=this.value;renderKeep()"></label>`)
        + table({
          cols: [{ l: 'Date', k: 'd', w: 80 }, { l: 'Source', k: 's', w: 130 }, { l: 'No', k: 'no', w: 190 }, { l: 'Account', k: 'a' }, { l: 'Debet', k: 'dr', num: 1, w: 160 }, { l: 'Kredit', k: 'cr', num: 1, w: 160 }],
          rows: rows.map(l => ({ on: l.on, c: { d: dayS(l.date), s: l.src, no: `<span class="nm">${esc(l.no)}</span>`, a: `<span class="one">${l.code} <span class="mute">${esc(nameOf(l.code.slice(0, 10)))}</span></span>`, dr: l.dr ? money(l.dr) : '', cr: l.cr ? money(l.cr) : '' } })),
          foot: { d: '', s: plural(list.length, 'line'), dr: money(sum(list, l => l.dr)), cr: money(sum(list, l => l.cr)) },
          empty: 'No line matches',
        }) + more
    } else {
      body = table({
        cols: [{ l: 'Template', k: 'n' }, { l: 'Every', k: 'ev', w: 190 }, { l: 'Amount', k: 'a', num: 1, w: 160 }, { l: 'Next', k: 'nx', w: 90 }, { l: 'Last jurnal', k: 'l', w: 180 }, { l: '', k: 'act', cls: 'act', w: 190 }],
        rows: JREC.map((t, i) => { const last = typeof t.last === 'function' ? t.last() : t.last; return { on: last ? `openJournal('${last}')` : '', c: { n: `<span class="nm">${esc(t.name)}</span>`, ev: t.every, a: money(typeof t.amt === 'function' ? t.amt() : t.amt), nx: dayS(t.next), l: last || DASH, act: btn('Make jurnal now', `pyJuRecur(${i})`, 'primary', 'ds-btn--sm cell') } } }),
      })
    }
    return page({ title: 'Journal', actions: [{ label: 'New jurnal', icon: 'plus', on: "openJournal('new')" }], tabs: [['jurnal', 'Jurnal', allJ().length], ['all', 'All jurnal', dots(oct.length)], ['recurring', 'Recurring', JREC.length]], tab, body })
  },
})

/* ── one jurnal, 7Soft style: header, the grid of lines, Total Debet · Total Kredit · Selisih ── */
let JNEW = null
const jnew = () => JNEW || (JNEW = { date: TODAY, ref: '', note: '', lines: [], tried: false })
const usedJu = () => Math.max(0, ...allJ().filter(j => j.no.startsWith('JU/HO/2610/')).map(j => +j.no.slice(-4)))
const nextJu = () => 'JU/HO/2610/' + pad4(Math.max(W.FIN_JU ? W.FIN_JU.n : 0, usedJu() + 1))
const takeJu = () => { const n = nextJu(); if (W.FIN_JU) W.FIN_JU.n = +n.slice(-4) + 1; return n }
const bumpJu = () => { if (W.FIN_JU) W.FIN_JU.n = Math.max(W.FIN_JU.n, usedJu() + 1) }
const jLine = ([b, l, u, dr, cr]) => ({ base: b, unit: unitOf(l), note: u, dr, cr })
function juProblems(d) {
  const p = [], ls = d.lines.filter(l => l.base || l.dr || l.cr)
  if (!ls.length) p.push('No lines yet')
  ls.forEach((l, i) => {
    if (!nameOf(l.base)) p.push(`Line ${i + 1}: account ${l.base || 'missing'}`)
    if (!UNITS.includes(l.unit)) p.push(`Line ${i + 1}: unit ${l.unit || 'missing'}`)
    if (!l.dr && !l.cr) p.push(`Line ${i + 1}: no amount`)
  })
  if (sum(d.lines, l => l.dr) !== sum(d.lines, l => l.cr)) p.push('Debet and Kredit differ')
  if (d.date < '2026-10-01') p.push('September is closed')
  return p
}
function juSheet(key) {
  const j = key === 'new' ? null : jFind(key), ro = !!j
  const d = ro ? { no: j.no, date: j.date, ref: j.ref, note: j.note, auto: j.auto, lines: j.lines.map(jLine) } : jnew()
  const tdr = sum(d.lines, l => l.dr), tcr = sum(d.lines, l => l.cr), diff = tdr - tcr, ok = tdr > 0 && !diff
  const jst = ro ? stOf(j) : 'new', rev = ro && revOf(j.no), [w, tone] = ro ? JST[jst] : ['New', 'info']
  const deprCodes = new Set(deprRun().map(l => l[0]))
  const dupDep = !ro && d.lines.some(l => deprCodes.has(l.base) && l.dr) && allJ().find(x => x.auto && stOf(x) === 'posted' && x.date.slice(0, 7) === d.date.slice(0, 7))
  const p = !ro && d.tried ? juProblems(d) : []
  const banner = (rev ? `<div class="banner warn">${ico('undo')}<span>Reversed by ${rev.no} on ${dayS(rev.date)}.</span>${lnk('Open it', `refreshSheet(juSheet('${rev.no}'))`)}</div>` : '')
    + (ro && j.st === 'reversal' && jFind(j.of) ? `<div class="banner info">${ico('undo')}<span>Reverses ${j.of}.</span>${lnk('Open it', `refreshSheet(juSheet('${j.of}'))`)}</div>` : '')
    + (dupDep ? `<div class="banner warn">${ico('alert')}<span>${periodOf(d.date)} depreciation is already posted on ${dupDep.no}.</span></div>` : '')
    + (p.length ? `<div class="banner bad">${ico('alert')}<span>${plural(p.length, 'thing')} to fix: ${p.map(esc).join(' · ')}</span></div>` : '')
  const dis = ro ? 'disabled' : ''
  const head = `<div class="kl-head" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
    <div class="kl-col">${field('No Jurnal', `<input value="${ro ? d.no : ''}" placeholder="${nextJu()}" disabled>`, { optl: 'auto' })}
      ${field('Tanggal', `<input type="date" value="${d.date}" max="${TODAY}" ${dis} onchange="jnew().date=this.value;refreshSheet(juSheet('new'))">`, { req: 1 })}
      ${field('Periode Acc', `<input value="${periodOf(d.date)}" readonly>`)}</div>
    <div class="kl-col">${field('No Referensi', `<input value="${esc(d.ref)}" placeholder="BKK, bill or memo number" ${dis} oninput="jnew().ref=this.value">`)}
      ${field('Keterangan', `<input value="${esc(d.note)}" placeholder="What this jurnal does" ${dis} oninput="jnew().note=this.value">`)}
      ${field('Otomatis', `<input value="${d.auto ? 'Yes · from Assets' : 'No'}" readonly>`)}</div></div>`
  const tools = ro ? '' : `<div class="kl-bar" style="align-items:center">${lnk('Penyusutan', 'pyJuDepr()', 'calendar')}${lnk('Del All', 'pyJuClear()', 'trash')}</div>`
  const rows = ro ? d.lines : [...d.lines, { base: '', unit: 'HO', note: '', dr: 0, cr: 0, blank: true }]
  const cell = (i, k, v, extra = '') => `<input data-r="${i}" data-k="${k}" value="${v}" ${extra}>`
  const grid = `<datalist id="ju-names">${coaBases().map(c => `<option value="${esc(nameOf(c))}" label="${c}">`).join('')}</datalist><datalist id="ju-units">${UNITS.map(u => `<option value="${u}">`).join('')}</datalist>
    <div class="kl-grid"><table><colgroup><col style="width:48px"><col><col style="width:140px"><col style="width:260px"><col style="width:90px"><col style="width:170px"><col style="width:170px"></colgroup>
    <thead><tr><th></th><th>Deskripsi Account</th><th>Kode Account</th><th>Uraian</th><th>Unit</th><th class="r">Debet</th><th class="r">Kredit</th></tr></thead><tbody>
    ${rows.map((l, i) => ro ? `<tr><td class="mute" style="text-align:center">${i + 1}</td><td>${esc(nameOf(l.base))}</td><td class="mute">${l.base}</td><td>${esc(l.note)}</td><td>${l.unit}</td><td class="r">${l.dr ? dots(l.dr) : ''}</td><td class="r">${l.cr ? dots(l.cr) : ''}</td></tr>`
      : `<tr class="${l.blank ? 'blank' : ''}"><td class="mute" style="text-align:center">${l.blank ? ico('plus') : i + 1}</td>
      <td class="cellin">${cell(i, 'name', esc(nameOf(l.base)), `list="ju-names" placeholder="${l.blank ? 'Type an account name or code' : ''}" onchange="pyJu(${i},'name',this.value)"`)}</td>
      <td class="cellin">${cell(i, 'code', l.base, `inputmode="numeric" maxlength="10" onchange="pyJu(${i},'code',this.value)"`)}</td>
      <td class="cellin">${cell(i, 'note', esc(l.note), `oninput="pyJu(${i},'note',this.value,1)"`)}</td>
      <td class="cellin">${cell(i, 'unit', l.unit, `list="ju-units" onchange="pyJu(${i},'unit',this.value,1)"`)}</td>
      <td class="cellin r">${cell(i, 'dr', l.dr ? dots(l.dr) : '', `inputmode="numeric" placeholder="0" oninput="pyJu(${i},'dr',this.value,1)"`)}</td>
      <td class="cellin r">${cell(i, 'cr', l.cr ? dots(l.cr) : '', `inputmode="numeric" placeholder="0" oninput="pyJu(${i},'cr',this.value,1)"`)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td></td><td>Total · ${plural(d.lines.length, 'line')}</td><td></td><td colspan="2" class="r">Selisih <span data-out="jdiff" class="${diff ? 'bad' : ''}">${dots(diff)}</span></td><td class="r" data-out="jdr">${dots(tdr)}</td><td class="r" data-out="jcr">${dots(tcr)}</td></tr></tfoot></table></div>`
  return {
    size: 'workspace', crumb: ['Journal', ro ? periodOf(d.date) : 'New'], title: ro ? d.no : 'New jurnal', titleText: ro ? d.no : 'New jurnal',
    pill: `${pill(w, tone)}${ro ? pill('READ ONLY', 'ro') : ''}`,
    body: `${banner}<fieldset class="kl" ${dis}>${head}${tools}${grid}</fieldset>${ro ? `<div class="kl-status"><span>Posted by ${esc(j.by)} · ${dayS(j.date)} ${j.at}</span></div>` : ''}`,
    foot: `<div class="foot-left">${lnk('Print jurnal', `soon('Print ${ro ? d.no : 'the jurnal'}')`, 'printer')}</div>${ro ? (jst === 'posted' && !j.sept ? btn('Reverse', `pyJuReverse('${j.no}')`) : '') : btn('Post jurnal', 'pyJuPost()', 'primary', `ju-post ${ok ? '' : 'is-disabled'}`)}`,
  }
}
function openJournal(no) { openSheet(juSheet(no || 'new')) }
function pyJu(i, k, v, soft) {
  const d = jnew()
  if (i >= d.lines.length) { d.lines.push({ base: '', unit: 'HO', note: '', dr: 0, cr: 0 }); soft = 0 }
  const l = d.lines[i]
  if (k === 'code') l.base = String(v).replace(/\D/g, '').slice(0, 10)
  else if (k === 'name') { const t = String(v).trim(), m = t.match(/^\d{10}/); l.base = m ? m[0] : glKeys().find(c => c.length === 10 && nameOf(c).toLowerCase() === t.toLowerCase()) || l.base }
  else if (k === 'unit') l.unit = String(v).trim().toUpperCase() || 'HO'
  else if (k === 'dr' || k === 'cr') {
    l[k] = parseRp(v)
    const o = k === 'dr' ? 'cr' : 'dr'
    if (l[k] && l[o]) { l[o] = 0; const el = sheetEl(`[data-r="${i}"][data-k="${o}"]`); if (el) el.value = '' }
  } else l[k] = v
  if (soft) return juOuts()
  refreshSheet(juSheet('new'))
  refocus(`[data-r="${i}"][data-k="${k === 'code' || k === 'name' ? 'note' : k}"]`)
}
function juOuts() {
  const d = jnew(), tdr = sum(d.lines, l => l.dr), tcr = sum(d.lines, l => l.cr), diff = tdr - tcr
  const set = (k, v) => { const el = sheetEl(`[data-out="${k}"]`); if (el) el.textContent = v }
  set('jdr', dots(tdr)); set('jcr', dots(tcr)); set('jdiff', dots(diff))
  const de = sheetEl('[data-out="jdiff"]'); if (de) de.className = diff ? 'bad' : ''
  const b = document.querySelector('#layers .ju-post'); if (b) b.classList.toggle('is-disabled', !(tdr > 0 && !diff))
}
function pyJuDepr() {
  const d = jnew()
  d.lines = deprRun().map(jLine)
  if (!d.note) d.note = `Penyusutan & amortisasi aktiva, ${BULAN[+d.date.slice(5, 7) - 1]} ${d.date.slice(0, 4)}`
  if (!d.ref) d.ref = 'Assets · Oktober 2026'
  refreshSheet(juSheet('new'))
}
function pyJuClear() { jnew().lines = []; refreshSheet(juSheet('new')) }
function pyJuRecur(i) {
  const t = JREC[i]
  JNEW = { date: TODAY, ref: t.ref, note: t.note, lines: t.lines().map(jLine), tried: false }
  openJournal('new')
}
function pyJuPost() {
  const d = jnew()
  d.tried = true
  if (juProblems(d).length) { refreshSheet(juSheet('new')); return }
  const no = takeJu()
  JOURNALS.unshift({ no, date: d.date, at: nowHM(), ref: d.ref, note: d.note || 'Jurnal umum', st: 'posted', by: FIN, lines: d.lines.filter(l => l.dr || l.cr).map(l => [l.base, locOf(l.unit), l.note, l.dr, l.cr]) })
  W.PAL_DOCS.push({ doc: 1, t: no, g: 'Journal', go: () => { go('journal'); setTimeout(() => openJournal(no), 30) } })
  JNEW = null
  render(); refreshSheet(juSheet(no))
  toast(`${no} posted`, money(sum(d.lines, l => l.dr)))
}
function pyJuReverse(no) {
  const j = jFind(no)
  if (!j || revOf(no)) return
  const n = takeJu()
  JOURNALS.unshift({ no: n, date: TODAY, at: nowHM(), ref: j.no, note: `Reversal ${j.no} · ${j.note}`, st: 'reversal', of: j.no, by: FIN, lines: j.lines.map(([b, l, u, dr, cr]) => [b, l, u, cr, dr]) })
  W.PAL_DOCS.push({ doc: 1, t: n, g: 'Journal', go: () => { go('journal'); setTimeout(() => openJournal(n), 30) } })
  render(); refreshSheet(juSheet(n))
  toast(`${n} posted`, `Reverses ${j.no}`)
}

/* ═════════ Accounting › Ledger ═════════ */
const accOpts = () => coaBases().map(c => [c, `${c} · ${nameOf(c)}`])
const unitOpts = () => [['all', 'All units'], ['HO', 'Head office'], ...STORES.map(s => [s.code, storeName(s.code)])]
function openLedger(base, unit) { S.f.ledger = { ...(S.f.ledger || {}), acc: base, unit: unit || 'all' }; go('ledger', 'sub') }
reg({
  id: 'ledger', group: 'acc', label: 'Ledger',
  s7: [['Info Accounting'], ['Buku Besar Pembantu', 'sub'], ['Neraca Saldo', 'tb'], ['Account', 'accounts']],
  render() {
    const id = 'ledger', tab = tabOf(id, 'accounts')
    let body, kpis
    if (tab === 'accounts') {
      const qq = S.q[id], rows = []
      COA_GROUPS.forEach(([g]) => {
        const xs = coaBases().filter(c => groupOf(c) === g && hit(qq, c, nameOf(c))).map(c => ({ c, s: bbp(c, 'all', 'this') }))
        if (!xs.length) return
        rows.push({ group: `${g} <span class="mute">· ${money(sum(xs, x => x.s.akhir))}</span>` })
        xs.forEach(({ c, s }) => { const mv = s.akhir - s.awal; rows.push({ on: `openLedger('${c}')`, cls: s.akhir || mv ? '' : 'dim', c: { k: `<span class="nm">${c}</span>`, n: `<span class="one">${esc(nameOf(c))}</span>`, a: money(s.awal), m: mv ? signed(mv) : '<span class="mute">0</span>', s: money(s.akhir) } }) })
      })
      body = bar(search(id, 'Account code or name'), spacer, `<span class="bar-count">${periodOf(TODAY)} · to ${dayS(TODAY)}</span>`)
        + table({ cols: [{ l: 'Kode', k: 'k', w: 150 }, { l: 'Account', k: 'n' }, { l: 'Saldo awal', k: 'a', num: 1, w: 180 }, { l: 'Mutasi', k: 'm', num: 1, w: 180 }, { l: 'Saldo', k: 's', num: 1, w: 180 }], rows, empty: 'No account matches' })
    } else if (tab === 'sub') {
      const f = S.f.ledger || {}, base = f.acc || '1011002001', unit = f.unit || 'all', per = f.per || 'this'
      const b = bbp(base, unit, per), { rows, more } = capRows(`bbp${base}${unit}${per}`, b.rows, 250)
      const [from] = per === 'last' ? ['2026-09-01'] : ['2026-10-01']
      body = bar(selectBox(accOpts(), base, "setFilt('ledger','acc',this.value)"), selectBox(unitOpts(), unit, "setFilt('ledger','unit',this.value)"), chips(id, 'per', [['this', 'This month'], ['last', 'Last month']], 'this'))
        + table({
          cols: [{ l: 'Tanggal', k: 'd', w: 90 }, { l: 'No', k: 'no', w: 200 }, { l: 'Keterangan', k: 'k' }, { l: 'Debet', k: 'dr', num: 1, w: 160 }, { l: 'Kredit', k: 'cr', num: 1, w: 160 }, { l: 'Saldo', k: 's', num: 1, w: 170 }],
          rows: [{ cls: 'dim', c: { d: dayS(from), no: 'Saldo awal', s: money(b.awal) } }, ...rows.map(r => ({ on: r.on, c: { d: dayS(r.date), no: `<span class="nm">${esc(r.no)}</span>`, k: `<span class="one">${esc(r.what)}</span>`, dr: r.dr ? money(r.dr) : '', cr: r.cr ? money(r.cr) : '', s: money(r.bal) } }))],
        }) + more
        + `<div style="margin-top:24px">${kpisHTML([{ label: 'Awal', value: money(b.awal) }, { label: 'Debet', value: money(b.dr) }, { label: 'Kredit', value: money(b.cr) }, { label: 'Saldo akhir', value: money(b.akhir) }])}</div>`
    } else {
      const date = (S.f.ledger || {}).tb || TODAY, net = tbAt(date), rows = []
      COA_GROUPS.forEach(([g]) => {
        const xs = Object.keys(net).filter(c => groupOf(c) === g && net[c]).sort()
        if (!xs.length) return
        rows.push({ group: g })
        xs.forEach(c => rows.push({ on: `openLedger('${c}')`, c: { k: `<span class="nm">${c}</span>`, n: `<span class="one">${esc(nameOf(c) || c)}</span>`, d: net[c] > 0 ? money(net[c]) : '', c: net[c] < 0 ? money(-net[c]) : '' } }))
      })
      const td = sum(Object.values(net).filter(v => v > 0)), tk = -sum(Object.values(net).filter(v => v < 0)), diff = td - tk
      body = bar(`<label style="display:inline-flex;align-items:center;gap:10px"><span class="mute">Sampai tanggal</span><input type="date" value="${(S.f.ledger || {}).tbPend || date}" min="2026-09-01" max="${TODAY}" onchange="(S.f.ledger=S.f.ledger||{}).tbPend=this.value" style="height:var(--control);padding:0 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--canvas)"></label>`, btn('Refresh', 'pyTbRefresh()'), spacer, `<span class="bar-count">${day(date)}</span>`)
        + table({
          cols: [{ l: 'Kode', k: 'k', w: 150 }, { l: 'Nama', k: 'n' }, { l: 'Debet', k: 'd', num: 1, w: 190 }, { l: 'Kredit', k: 'c', num: 1, w: 190 }],
          rows, foot: { k: 'Total', n: `Selisih <span class="${diff ? 'bad' : ''}">${money(diff)}</span>`, d: money(td), c: money(tk) },
        })
    }
    return page({ title: 'Ledger', tabs: [['accounts', 'Accounts'], ['sub', 'Buku besar pembantu'], ['tb', 'Neraca saldo']], tab, kpis, body })
  },
})
function pyTbRefresh() { const f = (S.f.ledger = S.f.ledger || {}); f.tb = f.tbPend || f.tb || TODAY; render(); toast('Neraca saldo refreshed', `Sampai ${day(f.tb)}`) }

/* ⌘K: jurnal and retur numbers land on their document */
W.PAL_DOCS.push(...JOURNALS.map(j => ({ doc: 1, t: j.no, g: 'Journal', go: () => { go('journal'); setTimeout(() => openJournal(j.no), 30) } })),
  ...RETURNS.map(r => ({ doc: 1, t: `${r.no} · ${supName(r.sup)}`, g: 'Bills › Returns', go: () => { go('bills', 'returns'); setTimeout(() => openPurchaseReturn(r.no), 30) } })))

Object.assign(W, {
  openBill, openSupplier, openJournal, openPurchaseReturn, openLedger, billForm, returnForm, juSheet, BF_set,
  pyTick, pyClear, pyPay, pyNewBill, pyBf, pyBfQty, pyBfAdv, pyBfFree, pyBfSave, pyRefund, pyReturnForm, pyRfQty, pyRfSave, pyRecur, pyGiro,
  pyJu, pyJuDepr, pyJuClear, pyJuRecur, pyJuPost, pyJuReverse, pyTbRefresh, jnew,
  /* for Month end and Reports: one ledger for every screen */
  LEDGER: { lines, tbAt, bbp, opening, kartuHutang, journals: allJ, loanRows },
})
Object.defineProperty(W, 'RF', { get: () => RF, configurable: true })
/* the jurnal counter is shared (Setup › Setting Menu, Assets, Month end): start it after the six above */
setTimeout(bumpJu, 0)
})()
