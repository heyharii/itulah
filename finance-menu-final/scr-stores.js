/* ═════════ Stores › Daily close ═════════
   Replaces 7Soft's Penjualan Cash · POS, Info Penjualan and Retur Penjualan (a return swaps the piece
   for another; no money goes back over the counter). The tills write every
   receipt; Finance checks one close per shop per day: what the POS says per payment, what was
   counted or what the bank will pay, the difference, then posts it. */
const TENDERS = [['cash', 'Cash'], ['debit', 'Debit'], ['credit', 'Credit'], ['qris', 'QRIS']]
const dayCloses = date => STORES.map(s => closeOf(date, s.code))
const POSTED_NOW = new Set()
const stateOf = d => POSTED_NOW.has(d.date + d.code) ? 'posted' : d.state

function closeRow(d) {
  const s = STORE[d.code], stt = stateOf(d), [w, tone] = CLOSE_WORD[stt]
  const card = d.t.debit + d.t.credit + d.t.qris
  return {
    on: `openClose('${d.date}','${d.code}')`, cls: stt === 'open' ? 'dim' : '',
    c: {
      store: `<span class="nm">${d.code}</span> <span class="mute">${esc(s.name)}</span>`,
      take: money(d.gross), cash: money(d.t.cash), card: money(card),
      counted: d.counted == null ? DASH : money(d.counted),
      diff: d.counted == null ? DASH : d.diff ? `<span class="${d.diff < 0 ? 'bad' : 'warn'}">${signed(d.diff)}</span>` : '<span class="mute">0</span>',
      st: st(w, tone),
    },
  }
}

reg({
  id: 'daily-close', group: 'stores', label: 'Daily close',
  s7: [['Penjualan Cash', 'days'], ['Penjualan Barcode (POS)', 'days'], ['Info Penjualan', 'receipts'], ['Retur Penjualan', 'returns'], ['Void', 'voids'], ['Laporan Penjualan · Harian', 'days']],
  badge: () => { const n = dayCloses(addDays(TODAY, -1)).filter(d => stateOf(d) !== 'posted').length; return n ? [n, 'warn'] : null },
  render() {
    const id = 'daily-close', tab = tabOf(id, 'days') === 'exchanges' ? 'returns' : tabOf(id, 'days')
    const all = dayCloses(S.day)
    const by = k => all.filter(d => stateOf(d) === k)
    const ready = by('ready'), diff = by('diff'), open = by('open')
    const take = all.reduce((a, d) => a + d.gross, 0)
    const cashDiff = all.reduce((a, d) => a + (d.counted == null ? 0 : d.diff), 0)
    const card = all.reduce((a, d) => a + d.t.debit + d.t.credit + d.t.qris, 0)
    const recs = all.reduce((a, d) => a + d.receipts, 0), exch = all.reduce((a, d) => a + d.exchN, 0), voids = all.reduce((a, d) => a + d.voidsN, 0)
    const toPost = ready.length + diff.length
    const actions = tab === 'days' && ready.length ? [{ label: `Post ${plural(ready.length, 'ready day')}`, on: 'postReady()' }] : []
    const kpis = [
      { label: 'Takings', value: money(take) },
      { label: 'Card & QRIS to the banks', value: money(card) },
      { label: 'Cash difference', value: signed(cashDiff), tone: cashDiff < 0 ? 'bad' : cashDiff > 0 ? 'warn' : '' , on: `setFilt('${id}','st','diff')` },
      { label: 'Shops closed', value: `${all.length - open.length} of ${all.length}`, tone: open.length ? 'bad' : '', on: `setFilt('${id}','st','open')` },
      { label: 'To post', value: String(toPost), on: `setFilt('${id}','st','ready')` },
    ]
    let body
    if (tab === 'days') {
      const f = filt(id, 'st', 'all')
      const rows = all.filter(d => f === 'all' || stateOf(d) === f).filter(d => hit(S.q[id], d.code, STORE[d.code].name, d.by))
      const sum = k => rows.reduce((a, d) => a + (typeof k === 'function' ? k(d) : d[k]), 0)
      body = bar(dayPick(), chips(id, 'st', [['all', 'All', all.length], ['ready', 'Ready to post', ready.length], ['diff', 'Difference', diff.length], ['open', 'Not closed', open.length], ['posted', 'Posted', by('posted').length]], 'all'), search(id, 'Shop or cashier'))
        + table({
          cols: [{ l: 'Shop', k: 'store' }, { l: 'Takings', k: 'take', num: 1, w: 150 }, { l: 'Cash', k: 'cash', num: 1, w: 140 }, { l: 'Card & QRIS', k: 'card', num: 1, w: 150 }, { l: 'Cash counted', k: 'counted', num: 1, w: 150 }, { l: 'Difference', k: 'diff', num: 1, w: 120 }, { l: 'Status', k: 'st', w: 180 }],
          rows: rows.map(closeRow), empty: 'No shop matches',
          foot: { store: plural(rows.length, 'shop'), take: money(sum('gross')), cash: money(sum(d => d.t.cash)), card: money(sum(d => d.t.debit + d.t.credit + d.t.qris)), counted: money(sum(d => d.counted || 0)), diff: signed(sum(d => d.counted == null ? 0 : d.diff)) },
        })
    } else if (tab === 'receipts') {
      const store = filt(id, 'store', 'all')
      const list = all.filter(d => store === 'all' || d.code === store).flatMap(d => receiptsOf(d.date, d.code).map(r => ({ ...r, code: d.code, date: d.date })))
        .filter(r => hit(S.q[id + 'r'], r.no, r.member, r.cashier, ...r.lines.map(l => l.a[1])))
      body = bar(dayPick(), selectBox([['all', 'All shops'], ...STORES.map(s => [s.code, storeName(s.code)])], store, `setFilt('${id}','store',this.value)`), `<label class="ds-search">${ico('search')}<input type="search" placeholder="Receipt, member or article" value="${esc(S.q[id + 'r'] || '')}" oninput="S.q['${id}r']=this.value;renderKeep()"></label>`, spacer, `<span class="bar-count">${plural(list.length, 'receipt')} shown of ${dots(recs)}</span>`)
        + table({
          cols: [{ l: 'Receipt', k: 'no', w: 190 }, { l: 'Shop', k: 'shop', w: 170 }, { l: 'Time', k: 'time', w: 90 }, { l: 'Cashier', k: 'cashier' }, { l: 'Member', k: 'member', w: 130 }, { l: 'Paid by', k: 'by', w: 150 }, { l: 'Items', k: 'items', num: 1, w: 90 }, { l: 'Total', k: 'total', num: 1, w: 150 }],
          rows: list.map(r => ({ on: `openReceipt('${r.date}','${r.code}','${r.no}')`, c: { no: `<span class="nm">${r.no}</span>`, shop: storeName(r.code), time: r.time, cashier: esc(r.cashier), member: r.member || DASH, by: r.method, items: num(r.lines.reduce((a, l) => a + l.qty, 0)), total: money(r.total) } })),
          empty: 'No receipt matches',
        })
    } else if (tab === 'returns') {
      const list = all.filter(d => d.exchN).flatMap(d => Array.from({ length: d.exchN }, (_, i) => ({ d, i })))
      body = bar(dayPick(), spacer, `<span class="bar-count">${plural(list.length, 'return')} · goods worth ${money(list.reduce((a, r) => a + r.d.exchVal / r.d.exchN, 0))}</span>`)
        + table({
          cols: [{ l: 'Return', k: 'no', w: 160 }, { l: 'Shop', k: 'shop', w: 190 }, { l: 'Brought back', k: 'back' }, { l: 'Taken instead', k: 'took' }, { l: 'Piece goes to', k: 'to', w: 150 }, { l: 'Top-up paid', k: 'top', num: 1, w: 140 }],
          rows: list.map(({ d, i }) => { SEED = d.gross % 997 + i; const r = receiptsOf(d.date, d.code)[i + 1] || receiptsOf(d.date, d.code)[0]; const back = pick(ARTICLES), took = pick(ARTICLES), why = pick(['Ukuran tidak pas', 'Cacat jahitan', 'Warna beda', 'Ganti model']); return { on: `openReceipt('${d.date}','${d.code}','${r.no}')`, c: { no: `<span class="nm">RT-${d.code}-${d.date.slice(8)}${i + 1}</span>`, shop: storeName(d.code), rec: r.no, back: `<span class="one">${esc(back[1])} <span class="mute">· ${why}</span></span>`, took: `<span class="one">${esc(took[1])}</span>`, to: why === 'Cacat jahitan' ? 'Reject' : 'Back to stock', top: i === 0 && d.topUp ? money(d.topUp) : DASH } } }),
          empty: 'No returns on this day',
        })
    } else {
      const list = all.filter(d => d.voidsN).flatMap(d => Array.from({ length: d.voidsN }, (_, i) => ({ d, i, amt: d.voidAmt / d.voidsN })))
      body = bar(dayPick(), spacer, `<span class="bar-count">${plural(list.length, 'void')} · ${money(list.reduce((a, r) => a + r.amt, 0))}</span>`)
        + table({
          cols: [{ l: 'Void', k: 'no', w: 160 }, { l: 'Shop', k: 'shop', w: 190 }, { l: 'Time', k: 'time', w: 90 }, { l: 'Cashier', k: 'cashier' }, { l: 'Approved by', k: 'head' }, { l: 'Reason', k: 'why', w: 210 }, { l: 'Amount', k: 'amt', num: 1, w: 140 }],
          rows: list.map(({ d, i, amt }) => { SEED = d.gross % 991 + i * 7; const si = STORES.indexOf(STORE[d.code]); return { c: { no: `<span class="nm">VD-${d.code}-${d.date.slice(8)}${i + 1}</span>`, shop: storeName(d.code), time: `${12 + Math.floor(rnd() * 8)}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}`, cashier: esc(PEOPLE[(si + 1) % PEOPLE.length]), head: `${esc(PEOPLE[si])} · finger`, why: pick(['Salah scan artikel', 'Pembeli batal', 'Salah pilih EDC', 'Harga belum update']), amt: money(amt) } } }),
          empty: 'No voids on this day',
        })
    }
    return page({ title: 'Daily close', actions, tabs: [['days', 'Days', all.length], ['receipts', 'Receipts', dots(recs)], ['returns', 'Returns', exch], ['voids', 'Voids', voids]], tab, kpis, body })
  },
})

function postReady() {
  const r = dayCloses(S.day).filter(d => stateOf(d) === 'ready')
  r.forEach(d => POSTED_NOW.add(d.date + d.code))
  toast(`${plural(r.length, 'day')} posted`, r.map(d => d.code).join(' · ') + ' · ' + dayS(S.day))
  render()
}

/* one shop's day: tenders as the POS says them, what was counted or what the bank will pay */
function openClose(date, code) {
  const d = closeOf(date, code), s = STORE[code], stt = stateOf(d), [w, tone] = CLOSE_WORD[stt]
  const e = edcOf(date, code)
  const bank = ACCOUNTS.find(a => a.kind === 'bank' && a.bank === s.edc && a.name.startsWith('Giro'))
  const tend = [
    { m: `Cash`, pos: d.cashExp, got: d.counted, to: `Cash on Hand · ${code}`, how: d.counted == null ? 'Not counted' : `Counted ${d.closedAt}` },
    { m: `Debit ${s.edc}`, pos: d.t.debit, got: d.t.debit, to: bank.name, how: `Bank pays ${dayS(e.credit)}` },
    { m: `Credit ${s.edc}`, pos: d.t.credit, got: d.t.credit, to: bank.name, how: `Bank pays ${dayS(e.credit)}` },
    { m: `QRIS ${s.edc}`, pos: d.t.qris, got: d.t.qris, to: bank.name, how: `Bank pays ${dayS(e.credit)}` },
  ]
  const recs = receiptsOf(date, code)
  const reasonBox = stt === 'diff' ? `<div class="banner warn">${ico('alert')}<span>Cash is ${d.diff < 0 ? 'short' : 'over'} by ${money(Math.abs(d.diff))}. Say why before posting — it posts to ${d.diff < 0 ? '1011102001 Piutang Pegawai (the cashier pays it back)' : '8010110002 Selisih pembulatan'}.</span></div>
      <div class="form-grid" style="grid-template-columns:1fr 2fr">${field('Why', `<select id="diffwhy"><option>${d.diff < 0 ? 'Kurang setor — kasir mengganti' : 'Lebih setor — kembalian kurang'}</option><option>Salah hitung, sudah dihitung ulang</option><option>Uang palsu ditolak bank</option></select>`)}${field('Note', '<input placeholder="Printed on the close">')}</div>` : ''
  const openBox = stt === 'open' ? `<div class="banner bad">${ico('alert')}<span>The till at ${code} was not closed. The POS shows ${plural(d.receipts, 'receipt')}, but no cash count has been sent.</span></div>` : ''
  const foot = `<div class="foot-left">${lnk('Print close', "soon('Print the close')", 'printer')}</div>` + (stt === 'ready' ? btn('Post day', `postClose('${date}','${code}')`) : stt === 'diff' ? btn('Post with difference', `postClose('${date}','${code}')`) : stt === 'open' ? btn(`Ask ${code} to close`, `toast('Reminder sent to ${esc(d.by)}','The head of ${code} gets it on the POS')`) : btn('Open journal', "soon('Journal of the close')"))
  openSheet({
    size: 'record', crumb: ['Daily close', `${weekday(date)} ${day(date)}`], title: `${code} · ${esc(s.name)}`, pill: pill(w, tone),
    body: `${openBox}${kpisHTML([{ label: 'Takings', value: money(d.gross) }, { label: 'Receipts', value: dots(d.receipts) }, { label: 'Returns', value: String(d.exchN) }, { label: 'Voided', value: d.voidsN ? `${d.voidsN} · ${money(d.voidAmt)}` : '0' }, { label: 'Cash difference', value: d.counted == null ? '—' : signed(d.diff), tone: d.diff < 0 ? 'bad' : d.diff > 0 ? 'warn' : '' }])}
      ${reasonBox}
      ${sec('Payments', table({
        cols: [{ l: 'Paid by', k: 'm', w: 160 }, { l: 'POS says', k: 'pos', num: 1, w: 150 }, { l: 'Counted or paid', k: 'got', num: 1, w: 160 }, { l: 'Difference', k: 'diff', num: 1, w: 120 }, { l: 'Goes to', k: 'to' }, { l: 'When', k: 'how', w: 170 }],
        rows: tend.filter(t => t.pos).map(t => ({ c: { m: `<span class="nm">${t.m}</span>`, pos: money(t.pos), got: t.got == null ? DASH : money(t.got), diff: t.got == null ? DASH : t.got - t.pos ? `<span class="${t.got - t.pos < 0 ? 'bad' : 'warn'}">${signed(t.got - t.pos)}</span>` : '<span class="mute">0</span>', to: t.to, how: `<span class="mute">${t.how}</span>` } })),
        foot: { m: 'Total', pos: money(d.cashExp + d.t.debit + d.t.credit + d.t.qris), got: d.counted == null ? DASH : money(d.counted + d.t.debit + d.t.credit + d.t.qris), diff: d.counted == null ? '' : signed(d.diff) },
      }), `<span class="mute">Bank fee about ${money(e.fee)}</span>`)}
      ${sec(`Receipts`, table({
        cols: [{ l: 'Receipt', k: 'no', w: 190 }, { l: 'Time', k: 'time', w: 80 }, { l: 'Cashier', k: 'cashier' }, { l: 'Paid by', k: 'by', w: 150 }, { l: 'Total', k: 'total', num: 1, w: 140 }],
        rows: recs.map(r => ({ on: `openReceipt('${date}','${code}','${r.no}')`, c: { no: `<span class="nm">${r.no}</span>`, time: r.time, cashier: esc(r.cashier), by: r.method, total: money(r.total) } })),
      }), `<span class="mute">${recs.length} of ${dots(d.receipts)}</span>`)}
      ${facts([['Cashiers', String(d.cashiers)], ['Closed', d.closedAt ? `${dayS(date)} · ${d.closedAt}` : '—'], ['Counted by', d.counted == null ? '—' : esc(d.by)], ['PPN in it', money(d.tax)]])}`,
    foot,
  })
}
function postClose(date, code) {
  POSTED_NOW.add(date + code)
  closeSheet(); render()
  toast(`${code} · ${dayS(date)} posted`, 'Cash to Cash on Hand, card and QRIS to the bank')
}

/* one receipt, as the till printed it (Cetak Ulang Nota) */
function openReceipt(date, code, no) {
  const r = receiptsOf(date, code).find(x => x.no === no) || receiptsOf(date, code)[0]
  const sub = r.lines.reduce((a, l) => a + l.a[2] * l.qty, 0), disc = r.lines.reduce((a, l) => a + l.disc, 0)
  openSheet({
    size: 'wide', crumb: ['Daily close', storeName(code)], title: r.no, pill: pill('Paid', 'ok'),
    body: `${facts([['Shop', storeName(code)], ['Time', `${dayS(date)} · ${r.time}`], ['Cashier', esc(r.cashier)], ['Paid by', r.method], ['Member', r.member || '—']])}
      ${sec('Items', table({
        cols: [{ l: 'Article', k: 'a' }, { l: 'SKU', k: 'sku', w: 150 }, { l: 'Qty', k: 'q', num: 1, w: 70 }, { l: 'Price', k: 'p', num: 1, w: 130 }, { l: 'Discount', k: 'd', num: 1, w: 120 }, { l: 'Subtotal', k: 's', num: 1, w: 140 }],
        rows: r.lines.map(l => ({ c: { a: `<span class="nm">${esc(l.a[1])}</span> <span class="mute">${l.a[0]}</span>`, sku: sku(l.a[0], l.v), q: num(l.qty), p: money(l.price), d: l.disc ? money(-l.disc) : DASH, s: money(l.price * l.qty - l.disc) } })),
      }))}
      <div class="ladder"><div><span class="mute">Subtotal</span><span>${money(sub)}</span></div><div><span class="mute">Discount</span><span>${disc ? money(-disc) : '0'}</span></div><div><span class="mute">PPN in it</span><span>${money(Math.round((sub - disc) * 11 / 111))}</span></div><div class="tot"><span>Total</span><span>${money(sub - disc)}</span></div></div>`,
    foot: btn('Print receipt again', "soon('Cetak ulang nota')"),
  })
}
