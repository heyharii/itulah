;(() => {
/* 7Soft, as it is — Master Account, Saldo Awal COA, Setting COA, Set Up, Customer/Supplier/Jangka Waktu Kredit/Pajak, Asset, User & Group, History.
   Words, columns, tabs and example rows are the manual's (screenshots PDF pp. 39–94, 223–229). */
const S7 = {}
const st7 = (id, init) => S7[id] || (S7[id] = init)
const f2 = v => (v < 0 ? '-' : '') + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const IN7 = 'style="width:100%;height:36px;padding:0 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--canvas);font:inherit;color:var(--ink)"'
const INR7 = 'style="width:100%;height:36px;padding:0 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--canvas);font:inherit;color:var(--ink);text-align:right;font-variant-numeric:tabular-nums"'
const i7 = (v, ro) => `<input ${IN7} value="${esc(v)}" ${ro ? 'readonly' : ''}>`
const r7 = v => `<input ${INR7} value="${esc(v)}">`
const ck = (on, fn = '') => `<input type="checkbox" class="cb7" ${on ? 'checked' : ''} ${fn ? `onchange="${fn}"` : ''}>`
const sel7 = (opts, cur, on = '') => `<select ${IN7} ${on ? `onchange="${on}"` : ''}>${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>` }).join('')}</select>`
const look = `<button type="button" style="border:0;background:none;color:var(--accent);font-weight:700;padding:0 6px;cursor:pointer" onclick="toast('...','Lookup — prototype')">…</button>`
const row2 = (a, b) => `<div style="display:flex;align-items:center;gap:8px">${a}${b || ''}</div>`
const mute = t => `<span class="mute" style="white-space:nowrap">${t}</span>`
const head7 = (title, tid, tabs, cur) => `<div class="door-head"><div class="door-top"><h1 class="ds-title">${title}</h1></div>${tabs ? tabsHTML(tid, tabs, cur) : ''}</div>`

/* ═════ the toolbar of every 7Soft window ═════ */
const TIP = { first: 'Ke record pertama', prior: 'Mundur 1 record sebelumnya', next: 'Ke data berikutnya', last: 'Ke record yang terakhir', new: 'Menambah / Insert data', del: 'Menghapus / Delete record yang dipilih', filter: 'Filter record sesuai dengan spesifikasi (Filter)', refresh: 'Refresh data', save: 'Simpan data', undo: 'Membatalkan perubahan', view: 'Cetak ke layar', print: 'Cetak ke printer', info: 'Info user pemakai dan tanggal serta edit terakhir', copy: 'Copy data yang sedang ditampilkan', import: 'Import dari file Excel', search: 'Cari', format: 'Format', default: 'Default' }
const NAME = k => k[0].toUpperCase() + k.slice(1)
const NAVH = {}
function tb7(id, keys, rec, total) {
  const off = k => (k === 'first' || k === 'prior') && rec <= 1 || (k === 'next' || k === 'last') && rec >= total || k === 'save' || k === 'undo'
  const b = k => `<button type="button" title="${esc(TIP[k])}" ${off(k) ? 'disabled' : ''} onclick="t7('${id}','${k}')" style="border:0;background:none;padding:6px 10px;border-radius:var(--r-inner);font:inherit;color:${off(k) ? 'var(--faint)' : 'var(--ink)'};cursor:${off(k) ? 'default' : 'pointer'}">${NAME(k)}</button>`
  return `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;padding:6px 8px;margin-bottom:16px;border:1px solid var(--hairline);border-radius:var(--r-card);background:var(--canvas)">${keys.map(b).join('')}<span style="margin-left:auto;padding:4px 16px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);font-variant-numeric:tabular-nums;color:var(--body)">${rec} of ${total}</span></div>`
}
window.t7 = (id, k) => {
  const h = NAVH[id]
  if (h && h(k)) return
  toast(NAME(k), TIP[k] + ' · prototype')
}
/* record navigation shared by the single-record windows */
const nav = (id, total) => k => {
  const s = st7(id, { rec: 0 })
  if (k === 'first') s.rec = 0; else if (k === 'prior') s.rec = Math.max(0, s.rec - 1); else if (k === 'next') s.rec = Math.min(total() - 1, s.rec + 1); else if (k === 'last') s.rec = total() - 1; else return false
  render(); return true
}
/* a 7Soft grid: head rows with spans, body rows of html cells, optional foot */
function grid(o) {
  const th = c => `<th ${c.cs ? `colspan="${c.cs}"` : ''} ${c.rs ? `rowspan="${c.rs}"` : ''} style="text-align:${c.num ? 'right' : 'center'};text-transform:uppercase">${c.t}</th>`
  const cols = `<colgroup>${o.cols.map(w => `<col${w ? ` style="width:${w}px"` : ''}>`).join('')}</colgroup>`
  const num = o.num || []
  const body = o.rows.length ? o.rows.map(r => `<tr>${r.map((c, i) => `<td class="${num.includes(i) ? 'is-num' : ''}">${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${o.cols.length}" class="mute" style="text-align:center;height:56px"></td></tr>`
  const foot = o.foot ? `<tfoot><tr>${o.foot.map((c, i) => `<td class="${num.includes(i) ? 'is-num' : ''}">${c}</td>`).join('')}</tr></tfoot>` : ''
  const w = o.cols.reduce((a, c) => a + (c || 140), 0)
  return `<div class="ds-table-card" style="overflow:auto"><table class="ds-table tbl t7" style="min-width:${o.min || w}px">${cols}<thead>${o.head.map(r => `<tr>${r.map(th).join('')}</tr>`).join('')}</thead><tbody>${body}</tbody>${foot}</table></div>`
}
const H = (...t) => t.map(x => typeof x === 'string' ? { t: x } : x)
const card = inner => `<div class="card7" style="margin-bottom:16px">${inner}</div>`
const txtbar = t => `<div style="margin:12px 0 0;font-weight:600">${t}</div>`
const sub = (...btns) => `<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin:16px 0 8px">${btns.join('')}</div>`
const plainBtn = (label, on, tip) => `<button type="button" title="${esc(tip || '')}" style="border:0;background:none;padding:6px 4px;font:inherit;color:var(--ink);cursor:pointer" onclick="${on}">${label}</button>`
const dtab = (tid, tabs, cur) => tabsHTML(tid, tabs, cur)

/* ═════ Account (Master Account) ═════ */
const TIPE = ['', 'AKTIVA LANCAR', 'AKTIVA TETAP', 'AKTIVA TAK BERWUJUD', 'AKTIVA LAIN - LAIN', 'INVESTASI JANGKA PANJANG', 'KAS/BANK']
const ACC = [
  { k: '1', n: 'AKTIVA', t: 'AKTIVA LANCAR', kids: [['10', 'AKTIVA LANCAR', 'AKTIVA LANCAR'], ['11', 'AKTIVA TETAP', 'AKTIVA TETAP'], ['12', 'AKTIVA TAK BERWUJUD', 'AKTIVA TAK BERWUJUD'], ['13', 'AKTIVA LAIN-LAIN', 'AKTIVA LAIN - LAIN'], ['14', 'INVESTASI JANGKA PANJANG', 'INVESTASI JANGKA PANJANG']] },
  { k: '2', n: 'KEWAJIBAN', t: '', kids: [] }, { k: '3', n: 'EKUITAS', t: '', kids: [] }, { k: '4', n: 'PENJUALAN', t: '', kids: [] },
  { k: '5', n: 'BIAYA', t: '', kids: [] }, { k: '6', n: 'PENDAPATAN/ BEBAN LAIN-LAIN', t: '', kids: [] }, { k: '9', n: 'kas', t: '', kids: [] },
]
NAVH['coa-master'] = nav('coa-master', () => ACC.length)
window.accTog = k => { const s = st7('coa-master', { rec: 0 }); (s.open = s.open || {})[k] = !s.open[k]; render() }
window.coaCreate = () => toast('Create Coa', 'Semua account yang telah di-create masuk ke daftar Saldo Awal COA — prototype')
reg7({
  id: 'coa-master', manual: 'Manual hal. 76–77 (2.16 Account) · 37 (7.1 Master Account)',
  render() {
    const s = st7('coa-master', { rec: 0 }), a = ACC[s.rec], open = s.open || {}
    const tree = ACC.map(x => `<div style="display:flex;align-items:center;gap:8px;padding:3px 8px;${x.k === a.k ? 'background:var(--accent);color:#fff' : ''}"><button type="button" style="border:1px solid var(--hairline-2);background:var(--canvas);width:18px;height:18px;line-height:14px;padding:0;color:var(--ink);cursor:pointer;font-size:15px" onclick="accTog('${x.k}')">${open[x.k] ? '−' : '+'}</button><span>${x.k}</span><span>${esc(x.n)}</span></div>${open[x.k] ? x.kids.map(c => `<div style="padding:3px 8px 3px 50px">${c[0]} &nbsp; ${esc(c[1])}</div>`).join('') : ''}`).join('')
    const rows = a.kids.map(c => [c[0], c[1], c[2], `<div style="text-align:center">${ck(true)}</div>`])
    return `${head7('Account')}${tb7('coa-master', ['first', 'prior', 'next', 'last', 'new', 'del', 'filter', 'refresh', 'save', 'undo', 'view', 'print', 'info'], s.rec + 1, ACC.length)}
      <div class="card7" style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:16px">
        <div style="display:flex;flex-direction:column;gap:16px">${field('Kode Account*', i7(a.k))}${field('Nama Account*', i7(a.n))}${field('Tipe Account*', sel7(TIPE.map(t => [t, t]), a.t))}</div>
        <div><div style="padding:4px 8px;background:var(--band);border:1px solid var(--hairline);font-weight:500">Account (Jgn Klik Tanda +)</div><div style="border:1px solid var(--hairline);border-top:0;min-height:200px">${tree}</div></div>
      </div>
      ${sub(plainBtn('Del All', "toast('Del All','Hapus semua baris detail — prototype')"), btn('Create Coa', 'coaCreate()'))}
      ${dtab('coa-master-d', [['d', `Detail ${rows.length ? 1 : 0} of ${rows.length}`]], 'd')}
      ${grid({ cols: [140, 0, 0, 120], head: [H('Kode Acc*', 'Nama Account*', 'Tipe Account*', 'Aktif')], rows })}`
  }
})

/* ═════ Saldo Awal COA ═════ */
const SA = [['100001', 'Kas Kecil', 155500], ['100002', 'Kas Besar', 0], ['100003', 'kas cintya', 0], ['100004', 'kas lidya', 0], ['100005', 'kas di erwin', 0], ['100006', 'KAS EVE DI CINA', 0], ['100007', 'titip kasan', 0],
  ['100101', 'Bank BCA', 23810968.55], ['100102', 'Bank MANDIRI', 18003263], ['100103', 'Bank BNI', 10605902], ['100104', 'Bank BCA VISA MASTER', 0], ['100105', 'Bank BCA CARD', 0], ['100106', 'Bank MANDIRI VISA MASTER', 0], ['100107', 'Bank BNI VISA MASTER', 0], ['100108', 'Bank MANDIRI 2', 40000000],
  ['100109', 'debit bca', 0], ['100120', 'debit mandiri', 0], ['100121', 'debit bni', 0], ['100122', 'BRI', 0], ['101001', 'Piutang Dagang - Customer', 24387900], ['101002', 'Piutang Dagang - Cadangan Kerugian', 0], ['101101', 'Piutang Karyawan', 0],
  ['101102', 'Piutang olivia', 0], ['101103', 'Piutang anita', 0], ['101104', 'piutang amanda', 0], ['101105', 'piutang lala', 0], ['101106', 'piutang sisca', 0], ['101107', 'piutang lia', 0]]
NAVH['coa-opening'] = k => ['first', 'prior', 'next', 'last'].includes(k) ? (toast(NAME(k), TIP[k] + ' · prototype'), true) : false
reg7({
  id: 'coa-opening', manual: 'Manual hal. 77–78 (2.17 Saldo Awal COA) · 37–38 (7.2)',
  render() {
    const rows = SA.map(r => [`<span style="font-variant-numeric:tabular-nums">${r[0]}</span>`, r[1], f2(r[2]), '201109'])
    return `${head7('Saldo Awal COA')}${tb7('coa-opening', ['first', 'prior', 'next', 'last', 'search', 'filter', 'format', 'default', 'save', 'undo', 'info', 'view', 'print'], 1, 281)}
      <div class="card7" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:16px"><span style="font-style:italic;font-weight:700;font-size:20px">CLOSED</span><div style="display:flex;align-items:center;gap:8px"><span>PERIODE</span><div style="width:160px">${i7('201109')}</div>${look}</div>${btn('Refresh', "toast('Refresh','Refresh data')")}${btn('Create New Saldo', "toast('Create New Saldo','Account baru dari Master Account masuk ke daftar saldo awal — prototype')")}</div>
      ${grid({ cols: [140, 0, 200, 130], num: [2, 3], head: [[{ t: 'Account', cs: 2 }, { t: 'Saldo Awal', rs: 2, num: true }, { t: 'Periode', rs: 2, num: true }], H('Kode', 'Nama')], rows, foot: ['', '', f2(0), ''] })}`
  }
})

/* ═════ Setting COA (and the item's Account tab) ═════ */
const SC = [['DEFAULT KAS KECIL', 'Kas Besar'], ['DISC PEMBELIAN', 'Diskon / Bonus / Pembelian'], ['DISC PENJUALAN', 'Potongan Penjualan'], ['HPP', 'HPP'], ['HUTANG', 'Utang Dagang - Supplier'], ['HUTANG SUSPEND', 'Utang Suspend'], ['LABA', 'Laba Bulan Ini'], ['LABA DITAHAN', 'Laba Ditahan'],
  ['PEMBELIAN JASA', 'Biaya Pembelian'], ['PENJUALAN', 'Penjualan Barang'], ['PENJUALAN JASA', 'Penjualan Jasa'], ['PERSEDIAAN BARANG', 'Persediaan Barang'], ['PIUTANG', 'Piutang Dagang - Customer'], ['POTONGAN HUTANG', 'Potongan Pembelian'], ['POTONGAN PIUTANG', 'Potongan Pembayaran'],
  ['PPN PEMBELIAN', 'Utang PPN - PPN Masukan'], ['PPN PENJUALAN', 'Utang PPN - PPN Keluaran'], ['RETUR PEMBELIAN', 'Persediaan Barang'], ['RETUR PENJUALAN', 'Retur Penjualan'], ['STOK ADJUSTMENT', ''], ['STOK OPNAME', 'beban adjust'], ['UANG MUKA PEMBELIAN', 'Uang Muka - Lain-Lain'], ['UANG MUKA PENJUALAN', 'Uang Muka - Lain-Lain']]
const IA = [['ACC. PENJUALAN', 'Penjualan Barang', '400001'], ['ACC. PERSEDIAAN', 'Persediaan Barang', '102101'], ['ACC. DISC. PENJUALAN', 'Potongan Penjualan', '410002'], ['ACC. HPP', 'HPP', '500001'], ['ACC. RET. PENJUALAN', 'Retur Penjualan', '410001'], ['ACC. RET. PEMBELIAN', 'Retur Pembelian', '102201'], ['ACC. HUTANG SUSPEND', 'Utang Suspend', '202101']]
window.scSet = (i, v) => { SC[i][1] = v; toast(SC[i][0], v || '—') }
reg7({
  id: 'coa-links', manual: 'Manual hal. 78–80 (2.18 Setting COA) · 49–50 (Account di master item)',
  render() {
    const tab = tabOf('coa-links7', 'set')
    let body
    if (tab === 'set') {
      body = `${tb7('coa-links', ['first', 'prior', 'next', 'last', 'search', 'filter', 'refresh', 'format', 'default', 'save', 'undo', 'info', 'view', 'print'], 1, SC.length)}
        <datalist id="sc-dl">${[...new Set(SC.map(r => r[1]).concat(IA.map(r => r[1])))].filter(Boolean).map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
        ${grid({ cols: [300, 0], head: [H('Keterangan', 'Account')], rows: SC.map((r, i) => [`<span style="text-transform:uppercase">${r[0]}</span>`, `<input ${IN7} list="sc-dl" value="${esc(r[1])}" onchange="scSet(${i},this.value)">`]) })}`
    } else {
      body = `<div class="card7" style="display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:24px">
        <div style="display:flex;flex-direction:column;gap:12px">${IA.map(r => `<div style="display:grid;grid-template-columns:200px minmax(0,1fr) 110px;gap:8px;align-items:center"><span>${r[0]}</span>${row2(i7(r[1]), look)}${row2(i7(r[2]), look)}</div>`).join('')}</div>
        <div style="display:flex;flex-direction:column;gap:16px;justify-content:center">${btn('Set as default', "toast('Set as default','Isian account yang ada menjadi default — prototype')")}${btn('Synkron Acc', "toast('Synkron Acc','Transaksi disesuaikan dari account lama menjadi account baru — prototype')")}</div></div>`
    }
    return `${head7('Setting COA(Chart Of Account)', 'coa-links7', [['set', 'Setting COA'], ['item', 'Item · Account']], tab)}${body}`
  }
})

/* ═════ Set Up (Persiapan Singkat) ═════ */
const YT = ['Ya', 'Tidak'], FOUR = ['Ya', 'Ya dengan peringatan', 'Ya dengan prompt', 'Tidak']
const PRICE_SO = ['Ya', 'Ya dengan peringatan', 'Ya dengan prompt', 'Tidak', 'Boleh asal tidak di bawah price list', 'Boleh di bawah price list dengan peringatan', 'Boleh di bawah price list dengan prompt']
const PRICE_INV = PRICE_SO.concat(['Boleh asal tidak di bawah HPP', 'Boleh di bawah HPP dengan peringatan', 'Boleh di bawah HPP dengan prompt'])
const SISP = ['PO-BD-Faktur Beli; Retur Barang-Faktur Retur Beli; Banyak BD-1 Faktur Beli', 'PO-BD-Faktur Beli; Faktur Retur Beli; Banyak BD-1 Faktur Beli', 'PO-Faktur Beli, Faktur Retur Beli', 'PO-BD-Faktur Beli; Retur Barang-Faktur Retur Beli; 1 BD–1 Faktur Beli', 'PO-BD-Faktur Beli; Faktur Retur Beli; 1 BD-1 Faktur Beli']
const SISJ = ['SO-SJ-Faktur Jual; Retur Barang-Faktur Retur Jual; Banyak SJ-1 Faktur Jual', 'SO-SJ-Faktur Jual; Faktur Retur Jual; Banyak SJ-1 Faktur Jual', 'SO-Faktur Jual, Faktur Retur Jual', 'SO-SJ-Faktur Jual; Retur Barang-Faktur Retur Jual; 1 SJ-1 Faktur Jual', 'SO-SJ-FakturJual; Faktur Retur Jual; 1 SJ-1 Faktur Jual']
const GEN = [
  ['tgl', 'Tanggal Mulai Program', 'date', '2026-10-01'], ['fgb', 'Folder Gambar', 'text', 'C:\\Seventhsoft\\Gambar'], ['ftp', 'Folder Template', 'text', 'C:\\Seventhsoft\\Template'],
  ['notrans', 'No Transaksi', 'sel', ['Bulanan otomatis', 'Bulanan manual', 'Tahunan otomatis', 'Tahunan manual'], 'Bulanan otomatis'],
  ['hist', 'Hapus History Report', 'sel', YT, 'Tidak'], ['saldo', 'Saldo Awal COA Mulai dari Awal', 'sel', YT, 'Ya'],
  ['cash', 'Form Penjualan Cash Tampil di Menu', 'sel', YT, 'Ya'], ['barc', 'Form Penjualan Barcode Tampil di Menu', 'sel', YT, 'Ya'],
  ['note', 'Tampilkan Note for Today', 'sel', ['Ya dalam Grid', 'Ya dalam Tabs', 'Ya dalam Grid Khusus Admin', 'Ya dalam Tabs Khusus Admin', 'Tidak'], 'Ya dalam Grid'],
  ['mgb', 'Tampilkan Menu Gambar', 'sel', ['Ya', 'Tidak', 'Ya Khusus Admin'], 'Ya'], ['jf', 'Jenis Form', 'sel', ['Besar', 'Kecil'], 'Besar'],
  ['dec', 'Jumlah Decimal Point', 'text', '2'], ['mcn', 'Maksimum Cetak Nota', 'text', '1'],
  ['sisp', 'Sistem Pembelian', 'sel', SISP, SISP[0]], ['sisj', 'Sistem Penjualan', 'sel', SISJ, SISJ[0]],
]
const TRX = [
  ['neg', 'Stok Boleh Minus', 'sel', FOUR, 'Ya dengan peringatan'], ['scr', 'Screening Stock per Tanggal Boleh Minus', 'sel', FOUR, 'Tidak'],
  ['ord', 'Nilai Order > Limit Hutang/Piutang', 'sel', FOUR, 'Ya dengan peringatan'], ['jb', 'Nilai Jual/Beli > Limit Hutang/Piutang', 'sel', FOUR, 'Ya dengan prompt'],
  ['po', 'Jumlah Item yang Dikirim > PO', 'sel', FOUR, 'Tidak'], ['so', 'Jumlah Item yang Dikirim > SO', 'sel', FOUR, 'Tidak'],
  ['bd', 'Barang Datang Boleh Tambah Baris', 'sel', YT, 'Ya'], ['sj', 'Surat Jalan Boleh Tambah Baris', 'sel', YT, 'Ya'], ['inv', 'Invoice Jual/Beli Matching Boleh Tambah Baris', 'sel', YT, 'Tidak'],
  ['hso', 'Harga Jual di SO Beda dengan Price List', 'sel', PRICE_SO, 'Ya dengan peringatan'], ['hfk', 'Harga Jual di Faktur Beda dengan SO/ Price List', 'sel', PRICE_INV, 'Boleh di bawah HPP dengan peringatan'],
  ['dso', 'Diskon Penjualan Beda dengan SO', 'sel', FOUR, 'Ya dengan peringatan'], ['hpp', 'HPP Ditampilkan di Penjualan dan Item', 'sel', ['Ya', 'Tidak', 'Ya Khusus Admin'], 'Ya Khusus Admin'],
  ['dd', 'Default Total Discount Penjualan Cash & Barcode', 'text', '0'], ['ppn', 'Pembulatan PPN', 'sel', ['Tanpa pembulatan', 'Pembulatan ke atas', 'Pembulatan ke bawah', 'Round'], 'Round'],
  ['bk', 'Default Tanggal BKK/BKM', 'sel', ['Otomatis', 'Manual'], 'Otomatis'], ['pn', 'Print Nota Penjualan Cash/ Barcode', 'sel', ['Otomatis', 'Manual'], 'Otomatis'], ['jbn', 'Jumlah Baris dalam Nota', 'text', '12'],
]
const CFG7 = {}
;[GEN, TRX].forEach(g => g.forEach(f => { CFG7[f[0]] = f[f.length - 1] }))
window.cf7 = (k, v) => { CFG7[k] = v; toast('Set Up', 'Diubah — klik Save untuk menyimpan') }
const cfField = f => field(f[1], f[2] === 'sel' ? sel7(f[3], CFG7[f[0]], `cf7('${f[0]}',this.value)`) : `<input ${IN7} ${f[2] === 'date' ? 'type="date"' : ''} value="${esc(CFG7[f[0]])}" onchange="cf7('${f[0]}',this.value)">`)
const SUTABS = [['info', 'Info Perusahaan'], ['setup', 'Setup'], ['akun', 'Setting Akun'], ['gudang', 'Gudang & Barang'], ['person', 'Person'], ['menu', 'Setting Menu']]
window.suNext = () => { const cur = tabOf('setup7', 'info'), i = SUTABS.findIndex(t => t[0] === cur); S.tab.setup7 = SUTABS[Math.min(SUTABS.length - 1, i + 1)][0]; render() }
window.impMaster = () => openSheet({
  crumb: ['Setup'], title: 'Export/Import Master', size: 'rail',
  body: `<div style="display:flex;flex-direction:column;gap:24px">${field('Pilih', sel7(['Export Master', 'Import Master'], 'Export Master'))}${field('Nama file', i7('master.7z'))}<label class="ds-check" style="gap:10px">${ck(false)}<span>Saldo awal</span></label></div>`,
  foot: btn('OK', "closeSheet();toast('OK','Export/Import Master — prototype')")
})
const TBL_EDIT = (items) => `<div style="display:flex;flex-direction:column;gap:12px">${items.map(([l, on]) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;border:1px solid var(--hairline);border-radius:var(--r-card);background:var(--canvas)"><span style="font-weight:500">${l}</span>${btn('Tambah/ Edit', on)}</div>`).join('')}</div>`
const goto7 = (id, tab, tid) => `S.v7=true;${tab ? `S.tab['${tid}']='${tab}';` : ''}go('${id}')`
const SM = [
  ['Master', 'MASTER', 100, '', 0, 0, 0, '', '', '', ''], ['LOV', 'Daftar Nilai', 101, '', 0, 0, 0, '', '', 'DAFTAR NILAI', 'FORM\\F_MAS_D'], ['Item', 'Item', 110, '', 0, 0, 0, 'Nama Item', '', 'ITEM', 'FORM\\F_MAS_It'],
  ['Formula', 'Formula ( BOM )', 111, '', 0, 0, 0, '', '', 'FORMULA', 'FORM\\F_MAS_B'], ['UOM', 'Satuan', 112, '', 0, 0, 0, '', '', 'SATUAN', 'FORM\\F_MAS_S'], ['Item_balance', 'Saldo awal', 114, '', 0, 0, 0, '', '', 'SALDO AWAL', 'FORM\\F_MAS_S'],
  ['Konversi', 'Konversi Item', 115, '', 0, 0, 0, '', '', 'KONVERSI', 'FORM\\F_MAS_K'], ['Gudang', 'Gudang', 120, '', 0, 0, 0, '', '', 'GUDANG', 'FORM\\F_MAS_G'], ['Jangka', 'Jangka Waktu Kredit', 121, '', 0, 0, 0, '', '', 'KREDIT', 'FORM\\F_MAS_J'],
  ['Alamat', 'Alamat', 122, '', 0, 0, 0, '', '', 'ALAMAT', 'FORM\\F_MAS_A'], ['Pajak', 'Pajak', 125, '', 0, 0, 0, '', '', 'PAJAK', 'FORM\\F_MAS_P'], ['Customer', 'Customer', 150, '', 0, 0, 0, 'Kode Customer / Supplier', '', 'CUSTOMER', 'FORM\\F_MAS_C'],
  ['Supplier', 'Supplier', 155, '', 0, 0, 0, 'Kode Customer / Supplier', '', 'SUPPLIER', 'FORM\\F_MAS_S'], ['Karyawan', 'Karyawan', 160, '', 0, 0, 0, '', '', 'KARYAWAN', 'FORM\\F_MAS_K'], ['Harga', 'Daftar Harga', 165, '', 0, 0, 0, '', '', 'DAFTAR HARGA', 'FORM\\F_MAS_H'],
  ['Asset', 'Asset', 170, '', 0, 0, 0, 'Kode Asset', '', 'ASSET', 'FORM\\F_MAS_A'], ['GL_Account', 'Account', 175, '', 0, 0, 0, '', '', 'ACCOUNT', 'FORM\\F_MAS_A'], ['GL_BALANCE', 'Saldo Awal COA', 179, '', 0, 0, 0, '', '', 'SACOA', 'FORM\\F_MAS_S'],
  ['Setting', 'Setting COA(Chart Of Account)', 180, '', 0, 0, 0, '', '', '', 'FORM\\F_MAS_S'], ['User', 'Setting User & Group', 190, '', 0, 0, 0, '', '', 'USER&GROUP', 'FORM\\F_MAS_L'], ['Menu', 'Setting Menu', 196, '', 0, 0, 0, '', '', 'MENU', 'FORM\\F_MAS_M'],
  ['Report', 'List Laporan', 198, '', 0, 0, 0, '', '', '', 'FORM\\F_MAS_L'], ['Inventory', 'INVENTORY', 200, '', 0, 0, 0, '', '', '', ''], ['Item_Inquiry', 'Info Barang & Stok', 210, '', 0, 0, 0, '', '', '', ''],
  ['PAC', 'Pindah Antar Gudang (PAG)', 220, 'PAG-', 0, 0, 0, 'Tanggal', '', 'PAG', 'FORM\\F_INV_PA'], ['Adjust_qty', 'Stok Adjustment', 240, 'ADJ-', 0, 1, 0, 'Tanggal', '', '', 'FORM\\F_INV_SA'], ['Adjust_Amount', 'Adjustment Nilai', 245, 'ADJN-', 0, 0, 0, 'Tanggal', '', '', 'FORM\\F_INV_SA'],
  ['Ret_beli_brg', 'Retur Barang ke Supplier', 257, '', 0, 0, 0, 'Tanggal', '', 'RETUR BELI', 'FORM\\F_INV_RE'], ['SJ_Retur', 'Retur Barang dari Customer', 258, '', 0, 0, 0, 'Tanggal', '', 'RETUR JUAL', 'FORM\\F_INV_RE'],
  ['Build', 'Perakitan', 260, 'PR-', 1, 0, 0, 'Tanggal', '', 'PERAKITAN', 'FORM\\F_INV_PF'], ['STOK_OPNAM_BULANAN', 'Stok Opname', 280, 'STK-', 0, 0, 0, 'Tanggal', '', '', ''],
]
reg7({
  id: 'setup-switches', manual: 'Manual hal. 19–31 (4. Persiapan Singkat: Info Perusahaan, Set Up) · 84–85 (2.20 Setting Menu)',
  render() {
    const tab = tabOf('setup7', 'info')
    const next = btn('Next', 'suNext()'), save = btn('Save', "toast('Save','Simpan data — prototype, nothing is saved')")
    let body = ''
    if (tab === 'info') body = `<div style="display:flex;justify-content:space-between;margin:12px 0 4px"><span style="font-weight:600;font-style:italic">Seluruh Informasi yang berhubungan dengan perusahaan untuk keperluan laporan</span><span style="font-weight:600;font-style:italic">Langkah 1 dari 15</span></div>
      <div class="card7" style="display:flex;flex-direction:column;gap:16px;max-width:620px">${field('Nama Perusahaan', i7('SEVENTHSOFT ACCOUNTING'))}${field('Logo Filename', row2(i7('7SOFT.BMP'), look))}${field('Alamat', row2(i7('00003'), look))}
      <div style="height:96px;border:1px dotted var(--hairline-2);border-radius:var(--r-inner)"></div>${field('NPWP', i7('  .   .   .  -   .   '))}${field('No Seri Faktur Pajak', i7('   -  .  -  '))}${field('No Pengukuhan PKP', i7('  .   .   .  -   .   '))}${field('Tanggal Pengukuhan PKP', `<input ${IN7} type="date">`)}</div>`
    if (tab === 'setup') body = `${section('General', `<div class="form-grid" style="grid-template-columns:repeat(2,1fr)">${GEN.map(cfField).join('')}</div>`)}${section('Transaksi', `<div class="form-grid" style="grid-template-columns:repeat(2,1fr)">${TRX.map(cfField).join('')}</div>`)}
      <div style="display:flex;gap:12px;flex-wrap:wrap">${btn('Kosongkan Database', "toast('Kosongkan Database','Menghapus semua data yang telah di-input — prototype, nothing is deleted')")}${btn('Import Master', 'impMaster()')}${btn('Restore Default', "toast('Restore Default','Setting awal sesuai setting asli aplikasi — prototype')")}</div>`
    if (tab === 'akun') body = `<div style="display:flex;flex-direction:column;gap:12px">${[['Daftar Akun', `<span style="display:flex;gap:8px">${btn('Clear All', "toast('Clear All','Hapus semua data account yang telah di-input — prototype, nothing is deleted')")}${btn('Use Default', "toast('Use Default','Menggunakan master account dari aplikasi — prototype')")}${btn('Tambah/ Edit', goto7('coa-master'))}</span>`], ['Setting Akun', btn('Tambah/ Edit', goto7('coa-links'))], ['Jangka Waktu Kredit', btn('Tambah/ Edit', goto7('parties', 'kredit', 'parties7'))], ['Daftar Pajak', btn('Tambah/ Edit', goto7('parties', 'pajak', 'parties7'))]].map(([l, b]) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;border:1px solid var(--hairline);border-radius:var(--r-card);background:var(--canvas)"><span style="font-weight:500">${l}</span>${b}</div>`).join('')}</div>`
    if (tab === 'gudang') body = TBL_EDIT(['Gudang', 'Satuan', 'Konversi', 'Barang', 'Harga Barang', 'Saldo Awal'].map(l => [l, `toast('${l}','Membuka Master ${l} — prototype')`]))
    if (tab === 'person') body = TBL_EDIT([['Daftar Supplier', goto7('parties', 'supplier', 'parties7')], ['Daftar Karyawan', "toast('Daftar Karyawan','Membuka Master Karyawan — prototype')"], ['Daftar Customer', goto7('parties', 'customer', 'parties7')]])
    if (tab === 'menu') body = `${tb7('setup-menu', ['first', 'prior', 'next', 'last', 'search', 'filter', 'refresh', 'format', 'default', 'save', 'undo', 'info', 'view', 'print'], 1, 79)}
      ${grid({ cols: [150, 240, 90, 110, 100, 90, 90, 90, 100, 220, 120, 150, 150], num: [2], head: [[{ t: 'Menu', rs: 2 }, { t: 'Display', rs: 2 }, { t: 'Urutan', rs: 2, num: true }, { t: 'Kode No Transaksi', rs: 2 }, { t: 'Tanggal Bisa Edit', rs: 2 }, { t: 'Tampil Awal', rs: 2 }, { t: 'Auto Insert', rs: 2 }, { t: 'Barcode', rs: 2 }, { t: 'Ganti Nama Item', rs: 2 }, { t: 'Sorting By', rs: 2 }, { t: 'Keterangan', rs: 2 }, { t: 'Template 1', cs: 2 }], H('Nama', 'File')],
        rows: SM.map(r => [r[0], r[1], r[2], r[3], ck(true), ck(false), ck(r[4]), ck(r[5]), ck(false), r[7], r[8], r[9], r[10]]) })}`
    const nsb = tab === 'menu' ? '' : `<div style="display:flex;justify-content:space-between;margin-bottom:16px">${next}${save}</div>`
    return `${head7('Persiapan Singkat', 'setup7', SUTABS, tab)}${nsb}${body}`
  }
})

/* ═════ Customer · Supplier · Jangka Waktu Kredit · Pajak ═════ */
const KREDIT = [['T0', '0 Hari (CASH)', 0, true, true], ['T7', '7 Hari', 7, false, true], ['T14', '14 Hari', 14, false, true], ['T21', '21 Hari', 21, false, true]]
const PAJAK = [['PPN0', 0, false], ['PPN10', 10, true]]
const kDesc = c => (KREDIT.find(k => k[0] === c) || ['', ''])[1]
const CUS = [
  { k: 'M89', n: 'AGUNG JAYA SENTOSA', term: 'T0', lim: 500000000, lok: 'SURABAYA', b1: '', inv: [] },
  { k: 'R144', n: 'SUSANA, TOKO.', term: 'T0', lim: 500000000, lok: 'SURABAYA', b1: 'JL. KALI RUNGKUT', tel: '031-87819', inv: [['PJL-10-01-00001', '30 Sep 2011', '09 Nov 2011', 6577000], ['PJL-10-01-00002', '30 Sep 2011', '09 Nov 2011', 16298000], ['PJL-10-01-00003', '30 Sep 2011', '09 Nov 2011', 250000]] },
  { k: 'C17', n: 'CITRA TERANG SINAR MULYO', term: 'T0', lim: 500000000, lok: 'SURABAYA', b1: '', inv: [] },
]
const SUP = [
  { k: 'S0001', n: 'PT. MAJU JAYA SURABAYA', term: 'T0', lim: 500000000, lok: 'SURABAYA', b1: 'SURABAYA', inv: [['HUT/21/01/2011', '28 Oct 2011', '28 Oct 2011', 240000]] },
  { k: 'S0002', n: 'SUMBER KOMPUTER', term: 'T0', lim: 500000000, lok: 'SURABAYA', b1: '', inv: [] },
]
NAVH['parties-c'] = nav('parties-c', () => CUS.length)
NAVH['parties-s'] = nav('parties-s', () => SUP.length)
NAVH['parties-k'] = NAVH['parties-p'] = () => false
window.impForm = tipe => openSheet({
  crumb: ['Customer'], title: 'Form Import',
  body: `<div style="font-weight:700;text-align:center;font-size:17px;margin-bottom:20px">PASTIKAN TIDAK ADA KOMPUTER LAIN MENGINPUT DATA SAMA DGN PROSES IMPORT YG SEDANG DI KERJAKAN !!! KARENA AKAN TERJADI ERROR DUPLICAT ENTRY</div>
    <div style="display:grid;grid-template-columns:200px 1fr;gap:16px;align-items:center;margin-bottom:20px"><span>TIPE IMPORT</span><div style="max-width:300px">${sel7(['ITEM', 'SUPPLIER', 'CUSTOMER', 'DAFTAR HARGA', 'ASSET', 'BOM'], tipe)}</div></div>
    <div style="font-weight:600;font-style:italic;margin-bottom:12px">File Excel yang dapat diimport formatnya harus seperti contoh di bawah ini</div>
    ${dtab('imp7', [['i', 'Contoh Import untuk Item'], ['s', 'Contoh Import untuk Supplier'], ['c', 'Contoh Import untuk Customer'], ['h', 'Contoh Import Untuk Daftar Harga'], ['a', 'Asset'], ['b', 'Import BOM']], 'c')}
    ${grid({ cols: [100, 100, 130, 120, 160, 100, 100, 100, 80], head: [H('KODE', 'NAMA', 'LIMIT_HUTANG', 'NPWP', 'CONTACT_PERSON', 'TELP1', 'TELP2', 'TELP3', 'FAX')], rows: [] })}
    <div style="font-weight:700;font-style:italic;margin-top:12px">- Kolom no_so, tanggal, kode_supplier dan kode_item HARUS DIISI, yang lain boleh Kosong<br>- Kolom Kode no_so TIDAK BOLEH KEMBAR</div>`,
  foot: [btn('Hapus Excel Lama', "toast('Hapus Excel Lama','Prototype')"), btn('Open Format Excel', "toast('Open Format Excel','Prototype')"), btn('Import', "toast('Import','Prototype')"), btn('Close', 'closeSheet()')].join('')
})
const addrRow = (r, cust) => {
  const lines = (a, tel) => `<div style="display:flex;flex-direction:column"><span><span class="mute">Baris1*</span> ${esc(a)}</span><span class="mute">Baris2</span><span class="mute">Baris3</span><span class="mute">Kota</span><span class="mute">Propinsi</span></div>`
  const ph = `<div style="display:flex;flex-direction:column"><span><span class="mute">#1</span> ${esc(r.tel || '')}</span><span class="mute">#2</span><span class="mute">#3</span><span class="mute">#4</span><span class="mute">#5</span></div>`
  const fx = `<div style="display:flex;flex-direction:column"><span class="mute">#1</span><span class="mute">#2</span></div>`
  return [r.lok, lines(r.b1), '', ...(cust ? [''] : []), ph, fx, '', `<div style="text-align:center">${ck(true)}</div>`, `<div style="text-align:center">${ck(false)}</div>`, `<div style="text-align:center">${ck(false)}</div>`, `<div style="text-align:center">${ck(false)}</div>`]
}
function partyForm(cust, rec, id) {
  const r = (cust ? CUS : SUP)[rec], total = (cust ? CUS : SUP).length
  const dTab = tabOf(id + 'd', 'detail')
  const term = row2(`<div style="width:90px">${i7(r.term)}</div>`, look + `<div style="flex:1">${i7(kDesc(r.term), true)}</div>`)
  const diskon = cust ? row2(`<div style="width:120px">${i7('')}</div>`, `<div style="flex:1">${r7('0.00')}</div>`) : row2(`<div style="width:120px">${i7('')}</div>`, `<span>%</span><div style="flex:1">${r7('0.00')}</div>`)
  const left = cust
    ? [field('Kode Customer*', row2(`<div style="width:220px">${i7(r.k)}</div>`, mute('kosong = otomatis'))), field('Nama Customer*', i7(r.n)), field('Termin Pembayaran', term), field('Batas JTempo', i7('')), field('Batas Piutang', r7(f2(r.lim))), field('Rayon', i7('')), field('No NPWP', i7('  .   .   .  -   .   ')), field('Diskon', diskon), field('Keterangan', i7(''))]
    : [field('Kode Supplier*', row2(`<div style="width:220px">${i7(r.k)}</div>`, mute('kosong = otomatis'))), field('Nama Supplier*', i7(r.n)), field('Termin Pembayaran', term), field('Batas Hutang', r7(f2(r.lim))), field('No NPWP', i7('  .   .   .  -   .   ')), field('Diskon', diskon), field('Keterangan', `<textarea ${IN7.replace('height:36px', 'height:72px;padding-top:8px')}></textarea>`)]
  const right = cust
    ? [field('Sales', row2(i7(''), look)), field('COA Piutang', `<div style="display:flex;flex-direction:column;gap:6px">${row2(i7('101001'), look)}${row2(i7('Piutang Dagang - Customer'), look)}</div>`), field('Tipe Harga Jual', `<input ${IN7} type="number" value="0" style="width:90px;height:36px;padding:0 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);font:inherit">`), `<label class="ds-check" style="gap:10px">${ck(false)}<span>TERMASUK SUPPLIER</span></label>`, `<label class="ds-check" style="gap:10px">${ck(true)}<span>STATUS &nbsp; AKTIF</span></label>`]
    : [field('COA Hutang', `<div style="display:flex;flex-direction:column;gap:6px">${row2(i7('201001'), look)}${row2(i7('Utang Dagang - Supplier'), look)}</div>`), `<label class="ds-check" style="gap:10px">${ck(false)}<span>TERMASUK CUSTOMER</span></label>`, `<label class="ds-check" style="gap:10px">${ck(true)}<span>STATUS &nbsp; AKTIF</span></label>`]
  const addr = grid({ cols: cust ? [130, 280, 120, 110, 190, 130, 110, 70, 80, 90, 80] : [130, 280, 130, 190, 130, 110, 70, 80, 100, 80],
    head: cust ? [[{ t: 'Lokasi*', rs: 2 }, { t: 'Alamat*', rs: 2 }, { t: 'Kontak', rs: 2 }, { t: 'Tgl. Lahir', rs: 2 }, { t: 'Phone', rs: 2 }, { t: 'Fax', rs: 2 }, { t: 'Bank Account', rs: 2 }, { t: 'Aktif', rs: 2 }, { t: 'Default Alamat', cs: 3 }], H('Kirim', 'Tagihan', 'Pajak')]
      : [[{ t: 'Lokasi*', rs: 2 }, { t: 'Alamat*', rs: 2 }, { t: 'Kontak', rs: 2 }, { t: 'Phone', rs: 2 }, { t: 'Fax', rs: 2 }, { t: 'Bank Account', rs: 2 }, { t: 'Aktif', rs: 2 }, { t: 'Default Alamat', cs: 3 }], H('Kirim', 'Penagihan', 'Pajak')],
    rows: [addrRow(r, cust)] })
  const saldo = grid({ cols: [200, 160, 160, 170, 0], num: [3], head: [H('No Faktur', 'Tanggal', 'Jatuh Tempo', 'Total', 'Keterangan')], rows: r.inv.map(v => [v[0], v[1], v[2], f2(v[3]), '']) })
  return `${tb7(id, ['first', 'prior', 'next', 'last', 'new', 'del', 'filter', 'refresh', 'save', 'undo', 'view', 'print', 'info', 'import'], rec + 1, total)}
    <div class="card7" style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:16px"><div style="display:flex;flex-direction:column;gap:14px">${left.join('')}</div><div style="display:flex;flex-direction:column;gap:14px">${right.join('')}</div></div>
    ${sub(plainBtn('Del All', "toast('Del All','Hapus semua baris detail — prototype')"))}
    ${dtab(id + 'd', [['detail', 'Detail 1 of 1'], ['saldo', 'Saldo Awal']], dTab)}
    ${dTab === 'detail' ? addr : saldo}
    <div style="margin-top:12px;font-weight:600">Saldo Awal READ ONLY karena periode awal sudah closing</div>`
}
const PT = [['customer', 'Customer'], ['supplier', 'Supplier'], ['kredit', 'Jangka Waktu Kredit'], ['pajak', 'Pajak']]
window.krSet = (i, j, v) => { KREDIT[i][j] = v; render() }
window.pjSet = (i, j, v) => { PAJAK[i][j] = v; render() }
window.impOpen = () => impForm(tabOf('parties7', 'customer') === 'supplier' ? 'SUPPLIER' : 'CUSTOMER')
NAVH['parties-c'] = (k) => k === 'import' ? (impForm('CUSTOMER'), true) : nav('parties-c', () => CUS.length)(k)
NAVH['parties-s'] = (k) => k === 'import' ? (impForm('SUPPLIER'), true) : nav('parties-s', () => SUP.length)(k)
reg7({
  id: 'parties', manual: 'Manual hal. 62–71 (2.11 Customer, 2.12 Supplier) · 67 (Jangka Waktu Kredit) · 62 (Pajak)',
  render() {
    const tab = tabOf('parties7', 'customer')
    let body
    if (tab === 'customer') body = partyForm(true, st7('parties-c', { rec: 1 }).rec, 'parties-c')
    else if (tab === 'supplier') body = partyForm(false, st7('parties-s', { rec: 0 }).rec, 'parties-s')
    else if (tab === 'kredit') body = `${tb7('parties-k', ['first', 'prior', 'next', 'last', 'new', 'del', 'search', 'filter', 'refresh', 'format', 'default', 'save', 'undo', 'info', 'view', 'print'], 1, KREDIT.length)}
      ${grid({ cols: [0, 0, 200, 120, 120], num: [2], head: [H('Nama / Kode*', 'Keterangan', 'Jangka Wkt (Hari)', 'Default', 'Aktif')], rows: KREDIT.map((k, i) => [`<input ${IN7} value="${esc(k[0])}" onchange="krSet(${i},0,this.value)">`, `<input ${IN7} value="${esc(k[1])}" onchange="krSet(${i},1,this.value)">`, `<input ${INR7} value="${k[2]}" onchange="krSet(${i},2,+this.value||0)">`, `<div style="text-align:center">${ck(k[3], `krSet(${i},3,this.checked)`)}</div>`, `<div style="text-align:center">${ck(k[4], `krSet(${i},4,this.checked)`)}</div>`]) })}`
    else body = `${tb7('parties-p', ['first', 'prior', 'next', 'last', 'new', 'del', 'search', 'filter', 'refresh', 'format', 'default', 'save', 'undo', 'info', 'view', 'print'], 1, PAJAK.length)}
      ${grid({ cols: [0, 0, 140], num: [1], head: [H('Kode Pajak*', 'Persen', 'Default')], rows: PAJAK.map((k, i) => [`<input ${IN7} value="${esc(k[0])}" onchange="pjSet(${i},0,this.value)">`, `<input ${INR7} value="${k[1]}" onchange="pjSet(${i},1,+this.value||0)">`, `<div style="text-align:center">${ck(k[2], `pjSet(${i},2,this.checked)`)}</div>`]) })}`
    return `${head7(PT.find(t => t[0] === tab)[1], 'parties7', PT, tab)}${body}`
  }
})

/* ═════ Asset (+ the Penyusutan step in Transaksi Jurnal) ═════ */
/* Umur and Rate are sample values: the manual does not show them */
const AS = [['01', 'GEDUNG MARGO', 1, 1000000000, 0, 'Bangunan', 'Bangunan', 20], ['02', 'GEDUNG SEGI 8', 1, 600000000, 0, 'Bangunan', 'Bangunan', 20], ['03', 'GEDUNG RUNGKUT', 1, 1500000000, 0, 'Bangunan', 'Bangunan', 20],
  ['04', 'TRUK L 7219 TH', 1, 300000000, 0, 'Kendaraan - Komersial', 'Kendaraan Komersial', 5], ['05', 'TRUK L 7220 TH', 1, 300000000, 0, 'Kendaraan - Komersial', 'Kendaraan Komersial', 5], ['06', 'TRUK L 7987 TA', 1, 300000000, 300000000, 'Kendaraan - Komersial', 'Kendaraan Komersial', 5],
  ['07', 'REG', 1, 15000000, 0, 'Sarana dan Instalasi', 'Sarana', 5], ['08', 'AC', 1, 5000000, 0, 'Peralatan Kantor', 'Peralatan Kantor', 5], ['09', 'MEJA KURSI LEMARI', 1, 10000000, 0, 'Peralatan Kantor', 'Peralatan Kantor', 5],
  ['10', 'SEPEDA MOTOR', 1, 20000000, 0, 'Kendaraan - Karyawan', 'Kendaraan Karyawan', 5], ['11', 'KOMPUTER', 1, 7000000, 0, 'Peralatan Komputer', 'Peralatan Komputer', 4], ['12', 'TRUK W 7376 KC', 1, 35000000, 0, 'Kendaraan - Komersial', 'Kendaraan Komersial', 5],
  ['13', 'KOMPUTER1', 5, 2767500, 0, 'Peralatan Komputer', 'Peralatan Komputer', 4], ['14', 'LAPTOP', 1, 9000000, 0, 'Peralatan Komputer', 'Peralatan Komputer', 4], ['15', 'HP', 1, 12000000, 5000000, 'Peralatan Komputer', 'Peralatan Komputer', 4], ['16', 'KALKULATOR', 1, 12000000, 11111, 'Peralatan Komputer', 'Mesin', 4]]
const rate = u => (100 / u).toFixed(2)
const JR = [['Bangunan', '110002', 1000000000], ['Bangunan', '110002', 600000000], ['Bangunan', '110002', 1500000000], ['Kendaraan - Komersial', '110004', 300000000], ['Kendaraan - Komersial', '110004', 300000000], ['Kendaraan - Komersial', '110004', 300000000], ['Sarana dan Instalasi', '110009', 15000000], ['Peralatan Kantor', '110006', 5000000], ['Peralatan Kantor', '110006', 10000000], ['Kendaraan - Karyawan', '110005', 20000000], ['Peralatan Komputer', '110007', 7000000], ['Kendaraan - Komersial', '110004', 35000000]]
const J = { mode: 'view', lines: [] }
window.jNew = () => { J.mode = 'new'; J.lines = []; render() }
window.jPeny = () => {
  J.lines = []
  AS.forEach(a => { const m = Math.round((a[3] - a[4]) / (a[7] * 12)); if (m > 0) { J.lines.push([`Biaya Depresiasi - ${a[6]}`, '', m, 0]); J.lines.push([`Akumulasi Penyusutan - ${a[6]}`, '', 0, m]) } })
  toast('PENYUSUTAN', 'Jurnal penyusutan bulan berjalan terbentuk sesuai info di Master Asset'); render()
}
NAVH['assets-j'] = k => k === 'new' ? (jNew(), true) : false
reg7({
  id: 'assets', manual: 'Manual hal. 74–75 (2.15 Asset) · 256–258 (1.19 Cara Input Fixed Asset dan Penyusutannya) · 204 (7.2 Transaksi Jurnal, PENYUSUTAN)',
  render() {
    const tab = tabOf('assets7', 'asset')
    let body
    if (tab === 'asset') {
      const rows = AS.map(a => [a[0], a[1], f2(a[2]), 'STRAIGHT LINE', f2(a[3]), f2(a[4]), a[5], `Biaya Depresiasi - ${a[6]}`, `Akumulasi Penyusutan - ${a[6]}`, `<div style="text-align:center">${ck(false)}</div>`, '', a[7], rate(a[7]), '', '', '', `<div style="text-align:center">${ck(true)}</div>`])
      body = `${tb7('assets', ['first', 'prior', 'next', 'last', 'new', 'del', 'search', 'filter', 'refresh', 'format', 'default', 'save', 'undo', 'info', 'view', 'print', 'import'], 1, AS.length)}
        ${grid({ cols: [100, 190, 100, 170, 160, 160, 210, 270, 270, 110, 140, 90, 110, 120, 130, 130, 80], num: [2, 4, 5, 11, 12],
          head: [[{ t: 'Kode Asset*', rs: 2 }, { t: 'Nama Asset*', rs: 2 }, { t: 'Jumlah', rs: 2, num: true }, { t: 'Metode Depresiasi', rs: 2 }, { t: 'Nilai Asset', rs: 2, num: true }, { t: 'Nilai Penyusutan', rs: 2, num: true }, { t: 'Account', cs: 3 }, { t: 'Intangible Asset', rs: 2 }, { t: 'Keterangan', rs: 2 }, { t: 'Umur Asset', rs: 2, num: true }, { t: 'Rate Depresiasi', rs: 2, num: true }, { t: 'Tipe Asset', rs: 2 }, { t: 'Tanggal Beli', rs: 2 }, { t: 'Tanggal Pemakaian', rs: 2 }, { t: 'Aktif', rs: 2 }], H('Asset*', 'Debet*', 'Kredit*')], rows })}`
    } else {
      const lines = J.mode === 'view' ? JR.map(r => [r[0], r[1], '', f2(r[2]), f2(0)]).concat([['Modal', '300001', '', f2(0), f2(4092000000)]]) : J.lines.map(r => [r[0], r[1], '', f2(r[2]), f2(r[3])])
      const td = lines.reduce((a, r) => a + parseFloat(r[3].replace(/,/g, '')), 0), tk = lines.reduce((a, r) => a + parseFloat(r[4].replace(/,/g, '')), 0)
      const ro = J.mode === 'view'
      body = `${tb7('assets-j', ['first', 'prior', 'next', 'last', 'new', 'del', 'filter', 'refresh', 'save', 'undo', 'view', 'print', 'info'], ro ? 1 : 1, ro ? 11 : 12)}
        <div class="card7" style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:16px"><div style="display:flex;flex-direction:column;gap:14px">${field('No Jurnal', i7(ro ? 'GL-07-08-00001' : 'GL-26-10-00001'))}${field('Tanggal', i7(ro ? '30 Aug 2007 11:42:47' : '27 Oct 2026'))}${field('No Referensi', i7(''))}${field('Keterangan', i7(''))}</div>${ro ? `<div style="font-weight:800;font-size:22px;color:#c00;align-self:center">READ ONLY</div>` : ''}</div>
        ${sub(plainBtn('Del All', "toast('Del All','Hapus semua baris detail — prototype')"), ro ? '' : btn('PENYUSUTAN', 'jPeny()'))}
        ${dtab('assets7-j', [['d', `Detail ${lines.length ? 1 : 0} of ${lines.length}`]], 'd')}
        ${grid({ cols: [0, 150, 220, 190, 190], num: [3, 4], head: [[{ t: 'Deskripsi Account', rs: 2 }, { t: 'Kode Account', rs: 2 }, { t: 'Uraian', rs: 2 }, { t: 'Jumlah', cs: 2 }], H('Debet', 'Kredit')], rows: lines })}
        <div style="display:grid;grid-template-columns:120px 200px 200px;gap:8px;margin-top:12px;align-items:center;justify-content:end"><span>TOTAL</span>${r7(f2(td))}${r7(f2(tk))}<span>SELISIH</span>${r7(f2(td - tk))}</div>`
    }
    return `${head7(tab === 'asset' ? 'Asset' : 'Transaksi Jurnal', 'assets7', [['asset', 'Asset'], ['jurnal', 'Transaksi Jurnal']].map(t => t[0] === 'jurnal' ? ['jurnal', 'Transaksi Jurnal'] : t), tab === 'asset' ? 'asset' : 'jurnal')}${body}`
  }
})

/* ═════ Setting User _Group ═════ */
const MENUL = [['MASTER', 'MASTER'], ...['Daftar Nilai', 'Item', 'Formula ( BOM )', 'Satuan', 'Saldo awal', 'Konversi Item', 'Gudang', 'Jangka Waktu Kredit', 'Alamat', 'Pajak', 'Customer', 'Supplier', 'Karyawan', 'Daftar Harga', 'Asset', 'Account', 'Saldo Awal COA', 'Setting COA(Chart Of Account)', 'Setting User & Group', 'Setting Menu', 'List Laporan'].map(x => [x, 'MASTER']),
  ['INVENTORY', 'INVENTORY'], ...['Info Barang & Stok', 'Pindah Antar Gudang (PAG)', 'Stok Adjustment', 'Adjustment Nilai', 'Retur Barang ke Supplier', 'Retur Barang dari Customer', 'Perakitan', 'Stok Opname'].map(x => [x, 'INVENTORY']),
  ['PEMBELIAN', 'PEMBELIAN'], ['PENJUALAN', 'PENJUALAN'], ...['Info Penjualan', 'Sales Order', 'Surat Jalan', 'Penjualan Cash', 'Penjualan Barcode (POS)', 'Faktur Penjualan', 'Retur Jual', 'Laporan Penjualan'].map(x => [x, 'PENJUALAN']),
  ['KAS - BANK', 'KAS - BANK'], ...['Info Kas_Bank', 'BKM (Bukti Kas/Bank Masuk)', 'BKK (Bukti Kas/Bank Keluar)'].map(x => [x, 'KAS - BANK']),
  ['GL', 'GL'], ...['Transaksi Jurnal', 'Closing Periode Akuntansi', 'Laporan Accounting'].map(x => [x, 'GL']),
  ['ANALISA', 'ANALISA'], ['FASILITAS', 'FASILITAS'], ...['List User Online', 'Restore and Patch', 'Back Up', 'Export/Import Master', 'Archive Data Lama', 'History Report', 'History'].map(x => [x, 'FASILITAS'])]
const MODS = ['MASTER', 'INVENTORY', 'PEMBELIAN', 'PENJUALAN', 'KAS - BANK', 'GL', 'ANALISA', 'FASILITAS']
const UG = [
  { n: 'SUPERADMIN', ket: '', on: true, perm: MENUL.map(() => [1, 1, 1, 1]), users: [['ADMIN', '', '', 1, 1, 1, '', '30 Nov 2007', '']] },
  { n: 'PIUTANG', ket: '', on: true, perm: MENUL.map(m => m[1] === 'PENJUALAN' ? [1, 1, 1, 1] : [0, 0, 0, 0]), users: [] },
]
NAVH['users'] = nav('users', () => UG.length)
window.upSet = (g, i, j, v) => { UG[g].perm[i][j] = v ? 1 : 0; render() }
window.upAll = (g, j, v) => { UG[g].perm.forEach(p => { if (j === 'all') p.fill(v ? 1 : 0); else p[j] = p[j] ? 0 : 1 }); render() }
window.utog = k => { const s = st7('users', { rec: 0 }); (s.open = s.open || {})[k] = !s.open[k]; render() }
reg7({
  id: 'users', manual: 'Manual hal. 81–83 (2.19 User & Group) · 40 (7.4 Master User & Group)',
  render() {
    const s = st7('users', { rec: 0 }), g = UG[s.rec], gi = s.rec, open = s.open || {}, dt = tabOf('users7d', 'detail')
    const any = (mod, j) => MENUL.some((m, i) => m[1] === mod && g.perm[i][j]) ? 'v' : ''
    const tree = MODS.map(mod => `<div style="display:grid;grid-template-columns:minmax(0,1fr) 70px 70px 70px 70px;align-items:center;padding:3px 8px;${mod === 'MASTER' ? 'background:var(--accent);color:#fff' : ''}"><span style="display:flex;align-items:center;gap:8px"><button type="button" style="border:1px solid var(--hairline-2);background:var(--canvas);width:18px;height:18px;line-height:14px;padding:0;color:var(--ink);cursor:pointer;font-size:15px" onclick="utog('${mod}')">${open[mod] ? '−' : '+'}</button>${mod}</span>${[0, 1, 2, 3].map(j => `<span style="text-align:center">${any(mod, j)}</span>`).join('')}</div>${open[mod] ? MENUL.map((m, i) => m[1] === mod && m[0] !== mod ? `<div style="display:grid;grid-template-columns:minmax(0,1fr) 70px 70px 70px 70px;padding:2px 8px 2px 42px"><span>${esc(m[0])}</span>${[0, 1, 2, 3].map(j => `<span style="text-align:center">${g.perm[i][j] ? 'v' : ''}</span>`).join('')}</div>` : '').join('') : ''}`).join('')
    let low
    if (dt === 'detail') low = grid({ cols: [140, 170, 150, 140, 90, 100, 100, 0, 150, 150], head: [[{ t: 'Nama User*', rs: 2 }, { t: 'Password', rs: 2 }, { t: 'Nama Lengkap', rs: 2 }, { t: 'Jabatan', rs: 2 }, { t: 'Report', cs: 3 }, { t: 'Keterangan', rs: 2 }, { t: 'Mulai Tanggal', rs: 2 }, { t: 'Sampai Tanggal', rs: 2 }], H('Admin', 'Template', 'To Excel')],
      rows: g.users.map(u => [u[0], '••••••••••••••', u[1], u[2], `<div style="text-align:center">${ck(u[3])}</div>`, `<div style="text-align:center">${ck(u[4])}</div>`, `<div style="text-align:center">${ck(u[5])}</div>`, u[6], u[7], u[8]]) })
    else low = `<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:12px">${plainBtn('Sellect All (Ctrl+L)', `upAll(${gi},'all',true)`)}${plainBtn('Unselect (Ctrl+U)', `upAll(${gi},'all',false)`)}${plainBtn('View (Ctrl+V)', `upAll(${gi},0)`)}${plainBtn('Add (Ctrl+A)', `upAll(${gi},1)`)}${plainBtn('Edit (Ctrl+E)', `upAll(${gi},2)`)}${plainBtn('Delete (Ctrl+D)', `upAll(${gi},3)`)}</div>
      ${grid({ cols: [260, 150, 0, 120, 120, 120, 120], head: [H('Display', 'Modul', 'Deskripsi Menu', 'View', 'Tambah', 'Edit', 'Hapus')], rows: MENUL.map((m, i) => [m[0], m[1], '', ...[0, 1, 2, 3].map(j => `<div style="text-align:center">${ck(g.perm[i][j], `upSet(${gi},${i},${j},this.checked)`)}</div>`)]) })}`
    return `${head7('Setting User _Group')}${tb7('users', ['first', 'prior', 'next', 'last', 'new', 'del', 'filter', 'refresh', 'save', 'undo', 'view', 'print', 'info', 'copy'], gi + 1, UG.length)}
      <div class="card7" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:24px;margin-bottom:16px"><div style="display:flex;flex-direction:column;gap:14px">${field('Nama Group*', i7(g.n))}${field('Keterangan', `<textarea ${IN7.replace('height:36px', 'height:72px;padding-top:8px')}></textarea>`)}<label class="ds-check" style="gap:10px">${ck(g.on)}<span>STATUS &nbsp; AKTIF</span></label></div>
        <div><div style="display:grid;grid-template-columns:minmax(0,1fr) 70px 70px 70px 70px;padding:4px 8px;background:var(--band);border:1px solid var(--hairline);font-weight:500;text-align:center"><span>MENU</span><span>VIEW</span><span>TAMBAH</span><span>EDIT</span><span>HAPUS</span></div><div style="border:1px solid var(--hairline);border-top:0;max-height:260px;overflow:auto">${tree}</div></div></div>
      ${sub(plainBtn('Del All', "toast('Del All','Hapus semua baris detail — prototype')"), plainBtn('Clear All', `upAll(${gi},'all',false)`), plainBtn('Create All', `upAll(${gi},'all',true)`))}
      ${dtab('users7d', [['detail', `Detail ${g.users.length ? 1 : 0} of ${g.users.length}`], ['menu', 'Menu']], dt)}${low}`
  }
})

/* ═════ History ═════ */
const HI = [['2/10/2016 9:21:07 AM', '', 'LAPORAN EXPORT XLS', 'Laporan Kas-Bank Detail Per Transaksi Pe', 'ADMIN'], ['2/10/2016 9:53:11 AM', 'Faktur Penjualan', 'TAMBAH', 'PJL-16-02-00003', 'ADMIN'], ['2/10/2016 9:49:20 AM', 'Faktur Penjualan', 'EDIT', 'UM-16-02-00002', 'ADMIN'],
  ['2/10/2016 9:48:50 AM', 'BKM (Bukti Kas/Bank Masuk)', 'EDIT', 'KM-16-02-00001', 'ADMIN'], ['2/10/2016 9:48:08 AM', 'BKM (Bukti Kas/Bank Masuk)', 'TAMBAH', 'KM-16-02-00001', 'ADMIN'], ['2/10/2016 9:46:14 AM', 'Faktur Penjualan', 'TAMBAH', 'PJL-16-02-00002', 'ADMIN'],
  ['2/10/2016 9:45:50 AM', 'Faktur Penjualan', 'TAMBAH', 'PJL-16-02-00001', 'ADMIN'], ['2/10/2016 9:45:31 AM', 'Surat Jalan', 'TAMBAH', 'SJ-16-02-00001', 'ADMIN'], ['2/10/2016 9:44:32 AM', 'Sales Order', 'TAMBAH', 'S-16-02-00001', 'ADMIN'],
  ['2/10/2016 8:59:01 AM', 'BKK (Bukti Kas/Bank Keluar)', 'TAMBAH', 'KK-16-02-00002', 'ADMIN'], ['2/10/2016 8:56:09 AM', 'Faktur Pembelian', 'EDIT', 'BLI-16-02-00001', 'ADMIN'], ['2/10/2016 8:56:01 AM', 'BKK (Bukti Kas/Bank Keluar)', 'TAMBAH', 'KK-16-02-00001', 'ADMIN'],
  ['2/10/2016 8:55:56 AM', 'Faktur Pembelian', 'EDIT', 'BLI-16-02-00002', 'ADMIN'], ['2/10/2016 8:55:39 AM', 'Faktur Pembelian', 'TAMBAH', 'BLI-16-02-00002', 'ADMIN'], ['2/10/2016 8:44:26 AM', 'Faktur Pembelian', 'TAMBAH', 'BLI-16-02-00001', 'ADMIN'],
  ['2/10/2016 8:40:14 AM', 'Barang Datang', 'TAMBAH', 'BPB-16-02-00001', 'ADMIN'], ['2/10/2016 8:30:59 AM', 'Order Pembelian', 'TAMBAH', 'P-16-02-00001', 'ADMIN'], ['10/31/2011 1:30:27 PM', 'Faktur Penjualan', 'EDIT', 'FJ-11-10-00001', ''],
  ['10/31/2011 1:30:06 PM', 'Faktur Penjualan', 'EDIT', 'FJ-11-10-00001', ''], ['10/31/2011 1:18:12 PM', 'Faktur Penjualan', 'EDIT', 'FJ-11-10-00001', 'ADMIN'], ['10/31/2011 1:13:06 PM', 'Faktur Penjualan', 'TAMBAH', 'FJ-11-10-00001', 'ADMIN'],
  ['10/31/2011 11:35:48 AM', 'Custom Report', 'EDIT', '12', 'ADMIN'], ['10/31/2011 11:25:56 AM', 'Custom Report', 'EDIT', '12', 'ADMIN'], ['10/31/2011 10:26:37 AM', 'Satuan', 'TAMBAH', 'GELINTIR', 'ADMIN'],
  ['10/31/2011 10:24:19 AM', 'Formula ( BOM )', 'TAMBAH', '11-10-00001', 'ADMIN'], ['10/31/2011 10:22:29 AM', 'Item', 'TAMBAH', '00005', 'ADMIN'], ['9/6/2011 5:09:13 PM', 'Setting User & Group', 'EDIT', 'SUPERADMIN', 'a'],
  ['9/6/2011 4:56:35 PM', 'Setting User & Group', 'EDIT', 'SUPERADMIN', 'ADMIN'], ['8/20/2011 4:58:41 PM', 'Item', 'EDIT', 'A10587444', 'ADMIN'], ['8/20/2011 4:58:34 PM', 'Item', 'EDIT', 'A10465', 'ADMIN'],
  ['8/20/2011 4:58:18 PM', 'Item', 'EDIT', 'A10587444', 'ADMIN'], ['8/18/2011 1:01:51 PM', 'Setting Menu', 'EDIT', 'Jual_Cash', ''], ['8/18/2011 1:01:45 PM', 'Setting Menu', 'EDIT', 'Jual_Brc', ''], ['8/18/2011 12:32:52 PM', 'Setting COA(Chart Of Account)', 'EDIT', 'Diskon / Bonus / Pembelian', 'ADMIN']]
NAVH['history'] = k => ['first', 'prior', 'next', 'last'].includes(k) ? (toast(NAME(k), TIP[k] + ' · prototype'), true) : false
reg7({
  id: 'history', manual: 'Manual hal. 223 (9.12 History: audit trail) · screenshot hal. 223',
  render() {
    return `${head7('History')}${tb7('history', ['first', 'prior', 'next', 'last', 'new', 'search', 'filter', 'refresh', 'format', 'default', 'save', 'undo', 'info', 'view', 'print'], 1, 550)}
      ${grid({ cols: [200, 260, 190, 0, 150], head: [H('Tanggal', 'Menu', 'Tipe', 'No Dokumen', 'User')], rows: HI })}`
  }
})
})()
