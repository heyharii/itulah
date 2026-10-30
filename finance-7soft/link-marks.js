/* the menu follows 7Soft: its menu names, in its order; anything 7Soft does not have goes to the bottom */
;(() => {
  const L7 = [
    ['cash', 'kas-info', 'Info Kas Bank'], ['cash', 'bkm-bkk', 'BKM · BKK'], ['cash', 'giro-board', 'Pencairan BG'], ['cash', 'kas-report', 'Laporan Kas/Bank'],
    ['gl', 'gl-info', 'Info Accounting'], ['gl', 'gl-journal', 'Transaksi Jurnal'], ['gl', 'gl-closing', 'Closing Periode'], ['gl', 'report-acc', 'Laporan Accounting & Keuangan'],
    ['buy', 'buy-info', 'Info Pembelian'], ['buy', 'buy-invoice', 'Faktur Pembelian'], ['buy', 'buy-return', 'Invoice Retur Beli'], ['buy', 'buy-reports', 'Laporan Pembelian'],
    ['sell', 'sell-info', 'Info Penjualan'], ['sell', 'sell-cash', 'Penjualan Cash · POS'], ['sell', 'sell-invoice', 'Faktur Penjualan'], ['sell', 'sell-return', 'Retur Penjualan'], ['sell', 'sell-reports', 'Laporan Penjualan'],
    ['master', 'coa-master', 'Account'], ['master', 'coa-opening', 'Saldo Awal COA'], ['master', 'coa-links', 'Setting COA'], ['master', 'setup-switches', 'Set Up'], ['master', 'parties', 'Customer · Supplier · Pajak'], ['master', 'assets', 'Asset'], ['master', 'users', 'User & Group'], ['master', 'history', 'History'],
  ]
  const order = []
  L7.forEach(([g, id, label]) => { const s = SCREENS.find(x => x.id === id); if (s) { s.group = g; s.label = label; delete s.tag; order.push(s) } })
  const NATIVE_ORDER = ['native-overview', 'native-stores', 'store-cash', 'native-payables', 'native-cash', 'native-journal', 'native-monthend', 'native-assets', 'native-reports', 'native-setup', 'native-interunit', 'native-payroll', 'native-opening', 'interunit', 'replica']
  SCREENS.filter(s => !order.includes(s)).sort((a, b) => {
    const ia = NATIVE_ORDER.indexOf(a.id), ib = NATIVE_ORDER.indexOf(b.id)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  }).forEach(s => { s.group = s.id === 'replica' ? 'ref' : 'native'; delete s.tag; order.push(s) })
  const cov = order.find(x => x.id === 'coverage'); if (cov) { order.splice(order.indexOf(cov), 1); order.unshift(cov); cov.group = 'top' }
  SCREENS.splice(0, SCREENS.length, ...order)
  GROUPS.splice(0, GROUPS.length, ['top', 'Overview'], ['cash', 'Kas - Bank'], ['gl', 'GL · Buku Besar'], ['buy', 'Pembelian'], ['sell', 'Penjualan'], ['master', 'Master'], ['native', 'Di luar 7Soft'], ['ref', 'Referensi 7Soft'])
})()
