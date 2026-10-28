/* ═════════ Cash & Bank › Cash & Bank ═════════
   7Soft's Info Kas Bank: every cash and bank account, as a card (Hari's sketch, 19 Oct):
   name · Books | Bank (statement date) · money in | money out · Reconcile | Upload statement,
   or Count cash for cash. The card opens the account's kartu. */
const KIND = { bank: 'Bank', cash: 'Cash', petty: 'Petty cash', float: 'Float' }
const placeOf = a => a.place === 'HO' ? 'HO' : `${a.place} ${STORE[a.place].name}`
const accMark = a => a.kind === 'bank' ? `<span class="acc-mark" style="background:${BANKS[a.bank].tone}">${BANKS[a.bank].short}</span>` : `<span class="acc-mark cash">${ico('wallet')}</span>`
const accSub = a => a.kind === 'bank' ? a.no : `${a.place} · ${a.code}`
function countedLine(a) {
  if (a.kind === 'bank') return { big: money(a.bankBal), sm: `Bank · ${dayS(a.stmt)}`, bad: a.bankBal !== a.books }
  const short = a.counted - a.books
  return { big: money(a.counted), sm: short ? `<span class="bad">${short < 0 ? 'Short' : 'Over'} ${money(Math.abs(short))}</span> · ${dayS(a.countedOn)}` : `Counted · ${dayS(a.countedOn)}`, bad: !!short }
}
function accCard(a) {
  const c = countedLine(a)
  const act = a.kind === 'bank'
    ? `${a.upload ? btn('Upload statement', `soon('Upload the ${a.name} statement')`) : btn(a.toMatch ? `Reconcile · ${a.toMatch}` : 'Reconcile', `reconcile('${a.id}')`)}${a.upload ? '' : lnk('Upload statement', `soon('Upload the ${a.name} statement')`, 'download')}`
    : btn('Count cash', `countCash('${a.id}')`)
  return `<div class="acc-card" onclick="openAccount('${a.id}')"><div class="acc-top">${accMark(a)}<div class="acc-name"><b>${a.name}</b><span>${accSub(a)}</span></div><span class="place">${placeOf(a)}</span></div>
    <div class="acc-bal"><div><div class="big">${money(a.books)}</div><div class="sm mute">Books</div></div><div><div class="big ${c.bad && a.kind === 'bank' ? '' : ''}">${c.big}</div><div class="sm mute">${c.sm}</div></div></div>
    <div class="acc-flow">${a.inM ? `<span class="in-amt">+${money(a.inM)}</span>` : '<span class="mute">Rp 0</span>'}${a.outM ? `<span class="out-amt">−${money(a.outM)}</span>` : '<span class="mute">Rp 0</span>'}</div>
    <div class="acc-act">${act}</div></div>`
}
reg({
  id: 'accounts', group: 'cash', label: 'Cash & Bank',
  s7: [['Info Kas Bank'], ['Kartu Kas/Bank'], ['Laporan Kas/Bank · Harian']],
  render() {
    const id = 'accounts', kind = filt(id, 'kind', 'all'), place = filt(id, 'place', 'all'), view = filt(id, 'view', 'cards')
    const list = ACCOUNTS.filter(a => (kind === 'all' || a.kind === kind) && (place === 'all' || a.place === place) && hit(S.q[id], a.name, a.no, a.code, a.place, a.place !== 'HO' && STORE[a.place].name))
    const n = k => ACCOUNTS.filter(a => a.kind === k).length
    const banks = ACCOUNTS.filter(a => a.kind === 'bank'), cash = ACCOUNTS.filter(a => a.kind !== 'bank')
    const toMatch = banks.reduce((x, a) => x + a.toMatch, 0)
    const short = cash.filter(a => a.counted !== a.books)
    const stale = cash.filter(a => daysBetween(a.countedOn, TODAY) > 7)
    const kpis = [
      { label: 'In banks', value: money(banks.reduce((x, a) => x + a.books, 0)), on: `setFilt('${id}','kind','bank')` },
      { label: 'In cash', value: money(cash.reduce((x, a) => x + a.books, 0)), on: `setFilt('${id}','kind','cash')` },
      { label: 'Bank lines to match', value: String(toMatch), on: "go('bank-rec')" },
      { label: 'Cash short or over', value: String(short.length), tone: short.length ? 'bad' : '' },
      { label: 'Not counted for a week', value: String(stale.length), tone: stale.length ? 'warn' : '' },
    ]
    const body = bar(chips(id, 'kind', [['all', 'All', ACCOUNTS.length], ['bank', 'Bank', n('bank')], ['cash', 'Cash', n('cash')], ['petty', 'Petty cash', n('petty')], ['float', 'Float', n('float')]], 'all'),
      selectBox([['all', 'Every place'], ['HO', 'Head office'], ...STORES.map(s => [s.code, storeName(s.code)])], place, `setFilt('${id}','place',this.value)`), search(id, 'Account or shop'), spacer,
      seg(id, 'view', [['cards', 'Cards'], ['list', 'List']], 'cards'))
      + (view === 'cards' ? (list.length ? `<div class="acc-grid">${list.map(accCard).join('')}</div>` : '<div class="empty-note">No account matches</div>')
        : table({
          cols: [{ l: 'Account', k: 'a' }, { l: 'Place', k: 'p', w: 170 }, { l: 'Books', k: 'b', num: 1, w: 170 }, { l: 'Bank or counted', k: 'c', num: 1, w: 170 }, { l: 'Date', k: 'd', w: 100 }, { l: 'In · Oct', k: 'i', num: 1, w: 170 }, { l: 'Out · Oct', k: 'o', num: 1, w: 170 }, { l: '', k: 'act', cls: 'act', w: 170 }],
          rows: list.map(a => { const c = countedLine(a); return { on: `openAccount('${a.id}')`, c: { a: `<span class="nm">${a.name}</span> <span class="mute">${accSub(a)}</span>`, p: placeOf(a), b: money(a.books), c: c.bad && a.kind !== 'bank' ? `<span class="bad">${c.big}</span>` : c.big, d: dayS(a.kind === 'bank' ? a.stmt : a.countedOn), i: `<span class="in-amt">+${money(a.inM)}</span>`, o: `<span class="out-amt">−${money(a.outM)}</span>`, act: a.kind === 'bank' ? btn(a.toMatch ? `Reconcile · ${a.toMatch}` : 'Reconcile', `reconcile('${a.id}')`, 'primary', 'ds-btn--sm cell') : btn('Count cash', `countCash('${a.id}')`, 'primary', 'ds-btn--sm cell') } } }),
        }))
    return page({ title: 'Cash & Bank', kpis, body })
  },
})
function reconcile(id) { S.f['bank-rec'] = { acc: id }; go('bank-rec') }

/* one account's kartu: every movement this month with the running balance */
function kartuOf(a) {
  const rows = []
  ;['bkk', 'bkm'].forEach(m => VOUCHERS[m].filter(v => v.acc === a.id && v.st === 'posted' && v.method !== 'giro').forEach(v => rows.push({ date: v.date, doc: v.no, what: v.party ? SUP[v.party].name : v.what, amt: m === 'bkm' ? v.amt : -v.amt, on: `openDoc('${m}','${v.no}')` })))
  if (a.kind === 'bank') {
    STORES.filter(s => s.edc === a.bank).length && a.name.startsWith('Giro') && [24, 25, 26].forEach(dd => {
      const date = `2026-10-${dd}`, shops = STORES.filter(s => s.edc === a.bank)
      rows.push({ date, doc: `Daily close · ${dayS(date)}`, what: `Card & QRIS · ${plural(shops.length, 'shop')}`, amt: shops.reduce((x, s) => x + edcOf(date, s.code).gross, 0), on: `go('daily-close')` })
    })
    GIROS.filter(g => g.acc === a.id && g.state === 'cleared' && g.cleared >= '2026-10-01').forEach(g => rows.push({ date: g.cleared, doc: `BG ${g.no} cleared`, what: SUP[g.sup].name, amt: -g.amt, on: `go('giro')` }))
  } else if (a.kind === 'cash' && a.place !== 'HO') {
    [24, 25, 26, 27].forEach(dd => { const date = `2026-10-${dd}`, d = closeOf(date, a.place); rows.push({ date, doc: `Daily close · ${dayS(date)}`, what: 'Cash takings', amt: d.cashExp, on: `openClose('${date}','${a.place}')` }); rows.push({ date: addDays(date, 1), doc: `Deposit ${a.place}-${date.slice(8)}`, what: `To Giro ${STORE[a.place].edc}`, amt: -round(d.cashExp * .96, 1000), on: `go('store-cash')` }) })
  }
  rows.sort((x, y) => x.date.localeCompare(y.date))
  const moved = rows.reduce((x, r) => x + r.amt, 0)
  let bal = a.books - moved
  const open = bal
  return { open, rows: rows.map(r => ({ ...r, bal: bal += r.amt })) }
}
function openAccount(id) {
  const a = ACC[id], c = countedLine(a), k = kartuOf(a)
  openSheet({
    size: 'workspace', crumb: ['Cash & Bank', placeOf(a)], title: `${a.name}${a.kind === 'bank' ? ' · ' + a.no : ''}`, pill: `<span class="code">${a.code}</span>`,
    body: `<div class="two"><div class="box"><div class="mute">Books</div><div style="font-size:24px;font-weight:600;letter-spacing:-.5px;margin-top:6px" class="ds-num">${money(a.books)}</div></div><div class="box"><div class="mute">${c.sm}</div><div style="font-size:24px;font-weight:600;letter-spacing:-.5px;margin-top:6px" class="ds-num">${c.big}</div></div></div>
      <div class="two"><div class="box"><div class="mute">Money in · October</div><div class="in-amt ds-num" style="font-size:18px;font-weight:600;margin-top:6px">+${money(a.inM)}</div></div><div class="box"><div class="mute">Money out · October</div><div class="out-amt ds-num" style="font-size:18px;font-weight:600;margin-top:6px">−${money(a.outM)}</div></div></div>
      ${sec('Kartu', table({
        cols: [{ l: 'Date', k: 'd', w: 90 }, { l: 'Document', k: 'doc', w: 230 }, { l: 'For', k: 'w' }, { l: 'In', k: 'i', num: 1, w: 160 }, { l: 'Out', k: 'o', num: 1, w: 160 }, { l: 'Balance', k: 'b', num: 1, w: 170 }],
        rows: [{ cls: 'dim', c: { d: '1 Oct', doc: 'Opening', w: '', i: '', o: '', b: money(k.open) } }, ...k.rows.map(r => ({ on: r.on, c: { d: dayS(r.date), doc: `<span class="nm">${esc(r.doc)}</span>`, w: `<span class="one">${esc(r.what)}${r.note ? ` <span class="mute">· ${r.note}</span>` : ''}</span>`, i: r.amt > 0 ? money(r.amt) : '', o: r.amt < 0 ? money(-r.amt) : '', b: money(r.bal) } }))],
        foot: { d: '', doc: plural(k.rows.length, 'line'), i: money(k.rows.filter(r => r.amt > 0).reduce((x, r) => x + r.amt, 0)), o: money(-k.rows.filter(r => r.amt < 0).reduce((x, r) => x + r.amt, 0)), b: money(a.books) },
      }), `<span class="mute">${dayS('2026-10-01')} – ${dayS(TODAY)}</span>`)}`,
    foot: `<div class="foot-left">${lnk('Print kartu', "soon('Print the kartu')", 'printer')}${a.kind === 'bank' ? lnk('Upload statement', `soon('Upload the ${a.name} statement')`, 'download') : ''}</div>${a.kind === 'bank' ? btn(a.toMatch ? `Reconcile · ${a.toMatch}` : 'Reconcile', `reconcile('${a.id}')`) : btn('Count cash', `countCash('${a.id}')`)}`,
  })
}
/* counting cash: notes and coins, the figure fills itself */
const DENOM = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100]
function countCash(id) {
  const a = ACC[id]
  openSheet({
    size: 'rail', crumb: ['Cash & Bank', placeOf(a)], title: `Count ${a.name.toLowerCase()}`,
    body: `<div class="ds-kpis kpis"><div class="ds-kpi"><div class="ds-kpi-label">Books</div><div class="ds-kpi-value">${money(a.books)}</div></div><div class="ds-kpi"><div class="ds-kpi-label">Counted</div><div class="ds-kpi-value" id="cc-sum">Rp 0</div></div><div class="ds-kpi"><div class="ds-kpi-label">Difference</div><div class="ds-kpi-value" id="cc-diff">—</div></div></div>
      <div class="kl-grid"><table><colgroup><col><col style="width:120px"><col style="width:170px"></colgroup><thead><tr><th>Note or coin</th><th class="r">Pieces</th><th class="r">Amount</th></tr></thead><tbody>${DENOM.map(d => `<tr><td>${money(d)}</td><td class="cellin r"><input inputmode="numeric" data-d="${d}" placeholder="0" oninput="ccSum(${a.books})"></td><td class="r" data-o="${d}">—</td></tr>`).join('')}</tbody></table></div>`,
    foot: btn('Save count', `closeSheet();toast('Count saved','${esc(a.name)} · ${placeOf(a)}')`),
  })
}
function ccSum(books) {
  let t = 0
  document.querySelectorAll('[data-d]').forEach(i => { const v = (+i.value || 0) * +i.dataset.d; t += v; document.querySelector(`[data-o="${i.dataset.d}"]`).textContent = v ? money(v) : '—' })
  $('#cc-sum').textContent = money(t)
  const d = t - books, el = $('#cc-diff'); el.textContent = t ? signed(d) : '—'; el.className = 'ds-kpi-value ' + (t && d ? (d < 0 ? 'is-bad' : 'is-warn') : '')
}

/* ═════════ Cash & Bank › BKK and BKM ═════════
   The register, and the voucher as a page of its own (owner, 29 Sep: "bkm bkk itu page saja
   jangan sheet"). The voucher is the Klasik form, unchanged: two-column head, total with
   terbilang, Settle · Other lines · Offset, a grid with In full. */
const MODE = {
  bkk: { code: 'BKK', party: 'Supplier', col: 'Paid', open: 'Payable', settle: 'Settle bills', offset: 'Offset receivables', offOpen: 'Receivable', amountLbl: 'Total paid', post: 'Post payment', invWord: 'bill', sign: -1, disc: '8010110003 Potongan Pembelian', next: 'BKK/HO/2610/0062', other: ['6010310006', '6010310007', '6010310001', '6010310004', '1011102001', '1011102002', '1011301003', '2012101002'] },
  bkm: { code: 'BKM', party: 'Customer', col: 'Received', open: 'Receivable', settle: 'Settle invoices', offset: 'Offset payables', offOpen: 'Payable', amountLbl: 'Total received', post: 'Post receipt', invWord: 'invoice', sign: 1, disc: '4010214001 Retur Penjualan', next: 'BKM/HO/2610/0025', other: ['8010110001', '8010110004', '8010110007', '1011102001', '1011102002', '8010110002'] },
}
const METHOD = { cash: 'Cash', transfer: 'Transfer', giro: 'Giro' }
const giroOfDoc = no => GIROS.find(g => g.bkk === no)
const GIROWORD = { written: ['Written', ''], with: ['With supplier', 'info'], cleared: ['Cleared', 'ok'], bounced: ['Bounced', 'bad'] }
function voucherState(m, v) {
  if (v.st === 'void') return ['Void', '']
  if (v.st === 'draft') return ['Draft', 'warn']
  const g = m === 'bkk' && v.method === 'giro' && giroOfDoc(v.no)
  if (g) return GIROWORD[g.state]
  return ['Posted', 'ok']
}
function registerScreen(m) {
  const t = MODE[m]
  reg({
    id: m, group: 'cash', label: t.code,
    s7: m === 'bkk' ? [['BKK (Bukti Kas/Bank Keluar)'], ['Pelunasan Hutang']] : [['BKM (Bukti Kas/Bank Masuk)'], ['Pelunasan Piutang']],
    badge: () => { const n = VOUCHERS[m].filter(v => v.st === 'draft').length; return n ? [n] : null },
    isDoc: x => x === 'new' || !!docOf(x),
    doc: no => voucherPage(m, no),
    render() {
      const id = m, f = filt(id, 'st', 'all'), list = VOUCHERS[m]
      const oct = list.filter(v => v.st === 'posted' && v.date >= '2026-10-01')
      const drafts = list.filter(v => v.st === 'draft')
      const giroW = m === 'bkk' ? GIROS.filter(g => g.state === 'with' || g.state === 'written') : []
      const kpis = [
        { label: m === 'bkk' ? 'Paid out · October' : 'Received · October', value: money(oct.reduce((a, v) => a + v.amt, 0)) },
        { label: 'Drafts', value: `${drafts.length} · ${money(drafts.reduce((a, v) => a + v.amt, 0))}`, on: `setFilt('${id}','st','draft')` },
        ...(m === 'bkk' ? [{ label: 'Giro still out', value: `${giroW.length} · ${money(giroW.reduce((a, g) => a + g.amt, 0))}`, on: "go('giro')" }] : []),
        { label: 'Void', value: String(list.filter(v => v.st === 'void').length), on: `setFilt('${id}','st','void')` },
      ]
      const n = k => list.filter(v => k === 'giro' ? v.method === 'giro' && v.st !== 'void' : v.st === k).length
      const rows = list.filter(v => f === 'all' || (f === 'giro' ? v.method === 'giro' && v.st !== 'void' : v.st === f))
        .filter(v => hit(S.q[id], v.no, v.what, v.party && SUP[v.party].name, v.giro, v.ref))
      const body = bar(chips(id, 'st', [['all', 'All', list.length], ['draft', 'Draft', n('draft')], ['posted', 'Posted', n('posted')], ...(m === 'bkk' ? [['giro', 'Giro', n('giro')]] : []), ['void', 'Void', n('void')]], 'all'), search(id, `${t.code} no, ${t.party.toLowerCase()}, giro or note`), spacer, `<span class="bar-count">October 2026</span>`)
        + table({
          cols: [{ l: 'Date', k: 'd', w: 84 }, { l: `${t.code} no`, k: 'no', w: 190 }, { l: m === 'bkk' ? 'Paid to' : 'Received from', k: 'p' }, { l: m === 'bkk' ? 'From' : 'Into', k: 'a', w: 230 }, { l: 'Amount', k: 'amt', num: 1, w: 160 }, { l: 'Status', k: 'st', w: 180 }],
          rows: rows.map(v => { const [w, tone] = voucherState(m, v), a = ACC[v.acc]; return { cls: v.st === 'void' ? 'dim' : '', on: `openDoc('${m}','${v.no}')`, c: { d: dayS(v.date), no: `<span class="nm">${v.no}</span>`, p: v.party ? `<span class="one">${esc(SUP[v.party].name)}</span>` : `<span class="one">${esc(v.what)}</span>`, a: `<span class="one">${a.name}${v.method === 'giro' ? ` · BG ${v.giro}` : ''}</span>`, amt: money(v.amt), st: st(w, tone) } } }),
          foot: { d: '', no: plural(rows.length, t.code), amt: money(rows.filter(v => v.st !== 'void').reduce((a, v) => a + v.amt, 0)) },
          empty: `No ${t.code} matches`,
        })
      return page({ title: t.code, actions: [{ label: `New ${t.code}`, icon: 'plus', on: `openDoc('${m}','new')` }], kpis, body })
    },
  })
}
registerScreen('bkk')
registerScreen('bkm')

/* ── the voucher being written or read ── */
const DOCS = {}
function draftOf(m, no) {
  const key = m + no
  if (DOCS[key]) return DOCS[key]
  const v = no === 'new' ? null : docOf(no)
  const d = {
    m, no: v ? v.no : '', isNew: !v, date: v ? v.date : TODAY, time: v ? v.time : '', acc: v ? v.acc : '', party: v ? v.party : null, method: v ? v.method : 'transfer',
    giro: v && v.method === 'giro' ? { no: v.giro, bank: ACC[v.acc].bank, due: (giroOfDoc(v.no) || {}).due || '' } : { no: '', bank: '', due: '' },
    ref: v ? v.ref || '' : '', note: v ? v.what : '', st: v ? v.st : 'draft', tab: 'settle', tried: false,
    other: v && v.other ? v.other.map(([a, n, x]) => ({ acc: a, note: n, amt: x })) : [],
    rows: [], offs: [],
  }
  d.rows = settleRowsFor(d, v)
  d.offs = offsetRowsFor(d, v)
  if (v && !v.settle && (v.other || []).length) d.tab = 'other'
  if (v && v.offset) d.tab = 'offset'
  return DOCS[key] = d
}
function settleRowsFor(d, v) {
  if (d.m === 'bkm' || !d.party) return []
  const settled = v && v.settle ? Object.fromEntries(v.settle) : {}
  const bills = BILLS.filter(b => b.sup === d.party && (billLeft(b) > 0 || settled[b.no]))
  return bills.map(b => { const amt = settled[b.no] || 0; return { no: b.no, due: b.due, open: settled[b.no] && v.st !== 'draft' ? settled[b.no] : billLeft(b), ref: b.inv, note: '', disc: 0, amt, pick: !!amt } })
}
function offsetRowsFor(d, v) {
  if (d.m !== 'bkm' || !d.party) return []
  const off = v && v.offset ? Object.fromEntries(v.offset) : {}
  return RETURNS.filter(r => r.sup === d.party).map(r => ({ no: r.no, due: r.date, open: r.total, ref: r.bill, note: r.reason, disc: 0, amt: off[r.no] || 0, pick: !!off[r.no] }))
}
const parseRp = s => +String(s).replace(/[^\d]/g, '') || 0
function sums(d) {
  const p = d.rows.filter(r => r.pick), o = d.offs.filter(r => r.pick)
  const settled = p.reduce((a, r) => a + r.amt, 0), disc = p.reduce((a, r) => a + r.disc, 0)
  const other = d.other.reduce((a, r) => a + (r.amt || 0), 0), off = o.reduce((a, r) => a + r.amt, 0)
  return { settled, disc, other, off, count: p.length, openSel: p.reduce((a, r) => a + r.open, 0), total: settled + other + (d.m === 'bkm' ? off : -off) }
}
function problems(d) {
  const p = {}
  if (!d.acc) p.acc = 'Pick the cash or bank account'
  if (!d.date) p.date = 'Date'
  if (d.method === 'giro') { if (!d.giro.no) p.giroNo = 'Giro number'; if (!d.giro.due) p.giroDue = 'Due date' }
  d.rows.forEach((r, i) => { if (r.pick && r.amt + r.disc > r.open) p['r' + i] = `${r.no} is paid more than it owes` })
  if (sums(d).total <= 0) p.total = `Nothing to ${d.m === 'bkk' ? 'pay' : 'receive'} yet`
  return p
}

function voucherPage(m, no) {
  const t = MODE[m], d = draftOf(m, no), ro = d.st !== 'draft', su = sums(d), p = d.tried ? problems(d) : {}
  const [w, tone] = d.isNew ? ['New', 'info'] : voucherState(m, docOf(d.no) || { st: d.st })
  const g = !d.isNew && m === 'bkk' && d.method === 'giro' && giroOfDoc(d.no)
  const accOpts = ACCOUNTS.filter(a => a.kind === 'bank' || a.place === 'HO')
  const err = k => p[k] ? 'err' : ''
  const head = `<div class="kl-head">
    <div class="kl-col">
      ${field('Voucher no', `<input value="${esc(d.no)}" placeholder="${t.next}" ${ro ? 'disabled' : ''} oninput="kd('${m}','${no}').no=this.value">`, { optl: 'auto' })}
      ${field('Date', `<input type="date" value="${d.date}" ${ro ? 'disabled' : ''} onchange="kd('${m}','${no}').date=this.value">`, { req: 1, cls: err('date') })}
      ${field('Cash / bank', `<select ${ro ? 'disabled' : ''} onchange="kset('${m}','${no}','acc',this.value)"><option value="">Pick an account</option>${accOpts.map(a => `<option value="${a.id}" ${a.id === d.acc ? 'selected' : ''}>${esc(accLabel(a))}</option>`).join('')}</select>`, { req: 1, cls: err('acc') })}
      ${field('Reference', `<input value="${esc(d.ref)}" placeholder="${m === 'bkm' ? 'Their transfer reference' : 'Our transfer reference'}" ${ro ? 'disabled' : ''} oninput="kd('${m}','${no}').ref=this.value">`)}
    </div>
    <div class="kl-col">
      ${field(d.party && m === 'bkm' ? 'Supplier' : t.party, `<select ${ro ? 'disabled' : ''} onchange="kset('${m}','${no}','party',this.value)"><option value="">No ${t.party.toLowerCase()}</option>${SUPPLIERS.map(s => `<option value="${s.code}" ${s.code === d.party ? 'selected' : ''}>${esc(s.name)} · ${s.code}</option>`).join('')}</select>`, { optl: `only to settle ${t.invWord}s` })}
      <div class="f7"><span>Paid by</span><div class="seg paidby" role="radiogroup">${Object.entries(METHOD).map(([k, l]) => `<button type="button" role="radio" aria-checked="${d.method === k}" ${ro ? 'disabled' : ''} onclick="kset('${m}','${no}','method','${k}')">${l}</button>`).join('')}</div></div>
      ${d.method === 'giro' ? `<div class="giro3">${field('Giro no', `<input value="${esc(d.giro.no)}" placeholder="456132" ${ro ? 'disabled' : ''} oninput="kd('${m}','${no}').giro.no=this.value">`, { req: 1, cls: err('giroNo') })}${field('Bank', `<input value="${esc(d.giro.bank || (ACC[d.acc] && ACC[d.acc].bank) || '')}" disabled>`)}${field('Due date', `<input type="date" value="${d.giro.due}" ${ro ? 'disabled' : ''} onchange="kd('${m}','${no}').giro.due=this.value">`, { req: 1, cls: err('giroDue') })}</div>` : ''}
      ${field('Note', `<input value="${esc(d.note)}" placeholder="Printed on the ${t.code}" ${ro ? 'disabled' : ''} oninput="kd('${m}','${no}').note=this.value">`)}
    </div>
    <div class="kl-total"><span class="lbl">${t.amountLbl}</span><div class="big"><small>Rp</small><span data-out="total">${dots(su.total)}</span></div><div class="words" data-out="words">${terbilang(su.total)}</div>
      <dl class="kl-mini"><div><dt>${t.settle}</dt><dd data-out="settled">${dots(su.settled)}</dd></div><div><dt>Discount given</dt><dd data-out="disc">${dots(su.disc)}</dd></div><div><dt>Other lines</dt><dd data-out="other">${dots(su.other)}</dd></div><div><dt>${t.offset}</dt><dd data-out="off">${su.off ? (m === 'bkm' ? '+ ' : '− ') + dots(su.off) : '0'}</dd></div></dl></div>
  </div>`
  const tabs = `<div class="kl-bar"><div class="ds-tabs" role="tablist">${[['settle', t.settle, su.count], ['other', 'Other lines', d.other.length], ['offset', t.offset, d.offs.filter(x => x.pick).length]].map(([k, l, c]) => `<button class="ds-tab ${d.tab === k ? 'is-selected' : ''}" role="tab" aria-selected="${d.tab === k}" type="button" onclick="kset('${m}','${no}','tab','${k}')">${l}<span class="tab-n">${c}</span></button>`).join('')}</div>
    ${ro ? '' : `${lnk(`Browse open ${t.invWord}s`, `soon('Every open ${t.invWord} of every ${t.party.toLowerCase()}')`, 'search')}${lnk('Replace a bounced giro', "go('giro')", 'undo')}`}</div>`
  const grid = d.tab === 'settle' ? settleGrid(d, no, ro, p) : d.tab === 'other' ? otherGrid(d, no, ro) : offsetGrid(d, no, ro)
  const probs = Object.values(p)
  const banner = ro ? (d.st === 'void' ? `<div class="banner warn">${ico('alert')}<span>Void. It stays on record and its journal was reversed; the number is never reused.</span></div>`
    : g && g.state === 'bounced' ? `<div class="banner bad">${ico('alert')}<span>BG ${g.no} bounced on ${dayS(g.bounced)} — ${esc(g.why)}. The ${t.invWord} it paid is open again.</span>${lnk('Replace on the Giro board', "go('giro')")}</div>` : '')
    : probs.length ? `<div class="banner bad">${ico('alert')}<span>${plural(probs.length, 'thing')} to fix: ${probs.map(esc).join(' · ')}</span></div>` : ''
  const foot = `<div class="kl-foot">${lnk(`Print ${t.code}`, `soon('Bukti ${m === 'bkk' ? 'Kas/Bank Keluar' : 'Kas/Bank Masuk'}')`, 'printer')}${ro && d.st === 'posted' ? lnk('Void…', `soon('Void asks why, then reverses the journal')`) : ''}<span class="sp"></span><span class="mute">${ro ? (d.st === 'posted' ? `Posted by ${FIN} · ${dayS(d.date)} ${d.time}` : '') : `<span class="kb">⌘</span> <span class="kb">↵</span> to post`}</span>${ro ? '' : btn(t.post, `kpost('${m}','${no}')`)}</div>`
  return page({
    crumb: [t.code, `go('${m}')`], title: d.isNew ? `New ${t.code}` : d.no,
    pill: `${pill(w, tone)}${ro && d.st !== 'void' ? pill('READ ONLY', 'ro') : ''}`,
    body: `${banner}<fieldset class="kl" ${ro ? 'disabled' : ''}>${head}${tabs}${grid}</fieldset>
      <div class="kl-status"><span>Discount and short-pay post to ${t.disc} — change it in Setup › Setting COA</span>${g ? `<span>BG ${g.no} · due ${dayS(g.due)} · ${GIROWORD[g.state][0]}</span>` : ''}</div>${foot}`,
  })
}
const kd = (m, no) => draftOf(m, no)
function kset(m, no, k, v) {
  const d = draftOf(m, no)
  if (k === 'party') { d.party = v || null; d.rows = settleRowsFor(d, null); d.offs = offsetRowsFor(d, null); d.tab = d.rows.length ? 'settle' : d.offs.length ? 'offset' : 'other' }
  else if (k === 'acc') { d.acc = v; if (ACC[v]) d.giro.bank = ACC[v].bank || ''; if (ACC[v] && ACC[v].kind !== 'bank' && d.method === 'giro') d.method = 'cash' }
  else d[k] = v
  render()
}
/* typing in a cell updates the totals without redrawing the form */
function kcell(m, no, list, i, k, el) {
  const d = draftOf(m, no), r = d[list][i]
  r[k] = k === 'note' ? el.value : parseRp(el.value)
  if (k === 'amt' && list !== 'other' && r.amt && !r.pick) { r.pick = true; el.closest('tr').classList.add('picked'); el.closest('tr').querySelectorAll('input:disabled').forEach(x => { x.disabled = false }) }
  if (list === 'rows') el.closest('tr').classList.toggle('over', r.amt + r.disc > r.open)
  const full = el.closest('tr').querySelector('[data-full]'); if (full) full.checked = r.pick && r.amt + r.disc === r.open
  kouts(d)
}
function kouts(d) {
  const su = sums(d), set = (k, v) => document.querySelectorAll(`[data-out="${k}"]`).forEach(x => { x.textContent = v })
  set('total', dots(su.total)); set('words', terbilang(su.total)); set('settled', dots(su.settled)); set('disc', dots(su.disc)); set('other', dots(su.other)); set('off', su.off ? (d.m === 'bkm' ? '+ ' : '− ') + dots(su.off) : '0')
  set('count', su.count); set('openSel', dots(su.openSel)); set('otherSum', dots(su.other)); set('offSum', dots(su.off))
}
function kpick(m, no, list, i, on) { const r = draftOf(m, no)[list][i]; r.pick = on; if (on && !r.amt) r.amt = r.open - r.disc; if (!on) { r.amt = 0; r.disc = 0 } render() }
function kfull(m, no, list, i, on) { const r = draftOf(m, no)[list][i]; if (on) { r.pick = true; r.amt = r.open - r.disc } render() }
function emptyParty(d, word) {
  if (!d.party) return `<div class="kl-grid"><div class="empty-note">${d.m === 'bkm' ? 'No customer picked. A receipt with no customer is income on Other lines: interest, rent, a refund.' : 'No supplier picked. A payment with no supplier goes on Other lines: power, rent, bank fees, petty cash.'}</div></div>`
  return `<div class="kl-grid"><div class="empty-note">${esc(SUP[d.party].name)} has no open ${word}.</div></div>`
}
function settleGrid(d, no, ro, p) {
  const t = MODE[d.m]
  if (d.m === 'bkm' && d.party) return `<div class="kl-grid"><div class="empty-note">${esc(SUP[d.party].name)} is a supplier, not a customer — use ${t.offset} for what it owes back.</div></div>`
  if (!d.rows.length) return emptyParty(d, t.invWord + 's')
  const su = sums(d), M = `'${d.m}','${no}'`
  return `<div class="kl-grid"><table><colgroup><col style="width:48px"><col style="width:170px"><col style="width:130px"><col style="width:150px"><col style="width:170px"><col><col style="width:140px"><col style="width:170px"><col style="width:76px"></colgroup>
    <thead><tr><th></th><th>${t.invWord === 'bill' ? 'Bill' : 'Invoice'}</th><th>Due</th><th class="r">${t.open}</th><th>Ref</th><th>Note</th><th class="r">Discount</th><th class="r">${t.col}</th><th>In full</th></tr></thead><tbody>
    ${d.rows.map((r, i) => `<tr class="${r.pick ? 'picked' : ''} ${r.amt + r.disc > r.open ? 'over' : ''}"><td style="text-align:center"><input type="checkbox" class="cb" ${r.pick ? 'checked' : ''} onchange="kpick(${M},'rows',${i},this.checked)" aria-label="Settle ${r.no}"></td>
      <td class="nm">${r.no}</td><td class="${r.due < TODAY && !ro ? 'bad' : ''}">${day(r.due)}</td><td class="r">${dots(r.open)}</td><td class="mute">${esc(r.ref)}</td>
      <td class="cellin"><input value="${esc(r.note)}" placeholder="Note" ${r.pick ? '' : 'disabled'} oninput="kcell(${M},'rows',${i},'note',this)"></td>
      <td class="cellin r"><input inputmode="numeric" value="${r.disc ? dots(r.disc) : ''}" placeholder="0" ${r.pick ? '' : 'disabled'} oninput="kcell(${M},'rows',${i},'disc',this)"></td>
      <td class="cellin r pay"><input inputmode="numeric" value="${r.amt ? dots(r.amt) : ''}" placeholder="0" oninput="kcell(${M},'rows',${i},'amt',this)" aria-invalid="${!!p['r' + i]}"></td>
      <td style="text-align:center"><input type="checkbox" class="cb" data-full ${r.pick && r.amt + r.disc === r.open ? 'checked' : ''} onchange="kfull(${M},'rows',${i},this.checked)" aria-label="${r.no} in full"></td></tr>`).join('')}
    </tbody><tfoot><tr><td></td><td colspan="2"><span data-out="count">${su.count}</span> of ${d.rows.length} picked</td><td class="r" data-out="openSel">${dots(su.openSel)}</td><td></td><td></td><td class="r" data-out="disc">${dots(su.disc)}</td><td class="r" data-out="settled">${dots(su.settled)}</td><td></td></tr></tfoot></table></div>`
}
/* Other lines: a sheet of cells — type the code or the name, a waiting blank row at the end */
function otherGrid(d, no, ro) {
  const t = MODE[d.m], M = `'${d.m}','${no}'`
  const rows = ro ? d.other : [...d.other, { acc: '', note: '', amt: 0, blank: true }]
  return `<datalist id="gl-${d.m}">${Object.entries(GL).map(([c, n]) => `<option value="${c} · ${esc(n)}">`).join('')}</datalist>
  <div class="kl-grid"><table><colgroup><col style="width:48px"><col style="width:420px"><col><col style="width:190px"></colgroup>
    <thead><tr><th></th><th>Account</th><th>Note</th><th class="r">Amount</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${r.blank ? 'blank' : ''}"><td class="mute" style="text-align:center">${r.blank ? ico('plus') : i + 1}</td>
      <td class="cellin"><input list="gl-${d.m}" value="${r.acc ? esc(r.acc + ' · ' + (GL[r.acc.slice(0, 10)] || '')) : ''}" placeholder="${r.blank ? 'Type an account code or name' : ''}" onchange="kother(${M},${i},'acc',this.value)"></td>
      <td class="cellin"><input value="${esc(r.note)}" placeholder="${r.blank ? '' : 'Note'}" oninput="kother(${M},${i},'note',this.value,1)"></td>
      <td class="cellin r"><input inputmode="numeric" value="${r.amt ? dots(r.amt) : ''}" placeholder="0" oninput="kother(${M},${i},'amt',this.value,1)"></td></tr>`).join('')}
    </tbody><tfoot><tr><td></td><td>${plural(d.other.length, 'line')}</td><td></td><td class="r" data-out="otherSum">${dots(sums(d).other)}</td></tr></tfoot></table></div>`
}
function kother(m, no, i, k, v, soft) {
  const d = draftOf(m, no)
  if (i >= d.other.length) { d.other.push({ acc: '', note: '', amt: 0 }); soft = 0 }
  const r = d.other[i]
  r[k] = k === 'amt' ? parseRp(v) : k === 'acc' ? (String(v).match(/^\d{10,12}/) || [''])[0] : v
  if (soft) { kouts(d) } else { render(); const inputs = document.querySelectorAll('.kl-grid tbody tr'); const row = inputs[i]; if (row) { const n = row.querySelectorAll('input')[k === 'acc' ? 1 : k === 'note' ? 1 : 2]; n && n.focus() } }
}
function offsetGrid(d, no, ro) {
  const t = MODE[d.m]
  if (d.m === 'bkk') return d.party ? `<div class="kl-grid"><div class="empty-note">${esc(SUP[d.party].name)} is not a customer — nothing to offset.</div></div>` : emptyParty(d, '')
  if (!d.offs.length) return d.party ? `<div class="kl-grid"><div class="empty-note">${esc(SUP[d.party].name)} owes nothing back.</div></div>` : emptyParty(d, '')
  const M = `'${d.m}','${no}'`
  return `<div class="banner info">${ico('undo')}<span>${esc(SUP[d.party].name)} is a supplier. Tick what it owes back — a return or a credit note — and the receipt grows by the same amount.</span></div>
  <div class="kl-grid"><table><colgroup><col style="width:48px"><col style="width:170px"><col style="width:130px"><col style="width:150px"><col style="width:170px"><col><col style="width:170px"><col style="width:76px"></colgroup>
    <thead><tr><th></th><th>Document</th><th>Date</th><th class="r">${t.offOpen}</th><th>Ref</th><th>Note</th><th class="r">Net off</th><th>In full</th></tr></thead><tbody>
    ${d.offs.map((r, i) => `<tr class="${r.pick ? 'picked' : ''}"><td style="text-align:center"><input type="checkbox" class="cb" ${r.pick ? 'checked' : ''} onchange="kpick(${M},'offs',${i},this.checked)"></td><td class="nm">${r.no}</td><td>${day(r.due)}</td><td class="r">${dots(r.open)}</td><td class="mute">${esc(r.ref)}</td>
      <td class="cellin"><input value="${esc(r.note)}" ${r.pick ? '' : 'disabled'} oninput="kcell(${M},'offs',${i},'note',this)"></td>
      <td class="cellin r"><input inputmode="numeric" value="${r.amt ? dots(r.amt) : ''}" placeholder="0" oninput="kcell(${M},'offs',${i},'amt',this)"></td>
      <td style="text-align:center"><input type="checkbox" class="cb" data-full ${r.pick && r.amt === r.open ? 'checked' : ''} onchange="kfull(${M},'offs',${i},this.checked)"></td></tr>`).join('')}
    </tbody><tfoot><tr><td></td><td colspan="5">${d.offs.filter(x => x.pick).length} of ${d.offs.length} picked</td><td class="r" data-out="offSum">${dots(sums(d).off)}</td><td></td></tr></tfoot></table></div>`
}
function kpost(m, no) {
  const d = draftOf(m, no), t = MODE[m]
  d.tried = true
  if (Object.keys(problems(d)).length) { render(); return }
  const num = d.no || t.next
  const su = sums(d)
  const v = { no: num, date: d.date, time: new Date().toTimeString().slice(0, 5), party: d.party, acc: d.acc, method: d.method, giro: d.giro.no, ref: d.ref, amt: su.total, st: 'posted', what: d.note || (su.count ? plural(su.count, t.invWord) : (d.other[0] && d.other[0].note) || 'Other lines'), settle: d.rows.filter(r => r.pick).map(r => [r.no, r.amt]), other: d.other.map(r => [r.acc, r.note, r.amt]) }
  const old = VOUCHERS[m].findIndex(x => x.no === d.no)
  if (old >= 0) VOUCHERS[m][old] = v; else VOUCHERS[m].unshift(v)
  if (m === 'bkk' && d.method === 'giro') { const g = GIROS.find(x => x.bkk === num); if (!g) GIROS.unshift({ no: d.giro.no, bank: ACC[d.acc].bank, acc: d.acc, bkk: num, sup: d.party || 'S-0102', amt: su.total, written: d.date, due: d.giro.due, state: 'written' }) }
  if (m === 'bkk') v.settle.forEach(([b, x]) => { const bill = BILLS.find(y => y.no === b); if (bill) bill.paid = Math.min(bill.total, bill.paid + x) })
  delete DOCS[m + no]
  if (m === 'bkk') MODE.bkk.next = 'BKK/HO/2610/' + String(+num.slice(-4) + 1).padStart(4, '0'); else MODE.bkm.next = 'BKM/HO/2610/' + String(+num.slice(-4) + 1).padStart(4, '0')
  toast(`${num} posted`, `${money(su.total)}${d.method === 'giro' ? ` · BG ${d.giro.no} waits on the Giro board` : ''}`)
  openDoc(m, num)
}
addEventListener('keydown', ev => { if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter' && S.doc && (S.id === 'bkk' || S.id === 'bkm')) { ev.preventDefault(); kpost(S.id, S.doc) } })
