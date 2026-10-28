/* ═════════ Stores › Store cash · Cash & Bank › Giro · Bank reconciliation ═════════
   One closure, so no name here can collide with another screen file; what the page's onclick
   handlers call is put on window at the end, prefixed sc · gr · rc. */
;(() => {
/* other screens draw from the shared random after us: leave it where we found it */
const keepSeed = f => { const s = SEED; try { return f() } finally { SEED = s } }
const GIRO_OF = { BCA: 'bca', Mandiri: 'mdr', BRI: 'bri', BNI: 'bni', Danamon: 'dnm' }
const boxOf = (k, code) => ACC[k + STORE[code].loc]
const shopCell = code => `<span class="nm">${code}</span> <span class="mute">${esc(STORE[code].name)}</span>`
const facts2 = xs => `<dl class="facts4" style="grid-template-columns:repeat(2,minmax(0,1fr))">${xs.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('')}</dl>`
/* a document number inside a table cell: opens it and keeps the row height */
const tlink = (label, on, done) => `<button class="lnk" type="button" style="height:auto;padding:0;border-radius:4px" onclick="event.stopPropagation();${on}">${done ? '<span class="ds-ico ds-ico-check" style="color:var(--ok-fg)"></span>' : ''}${label}</button>`
const left = html => `<div style="text-align:left">${html}</div>`
const cellBtn = (label, on) => left(btn(label, on, 'primary', 'ds-btn--sm cell'))
const lateWord = n => `${plural(n, 'day')} late`
const sumOf = (xs, k = 'amt') => xs.reduce((s, x) => s + (typeof k === 'function' ? k(x) : x[k] || 0), 0)
const moneyIn = id => `oninput="this.value=this.value.replace(/[^0-9]/g,'').replace(/\\B(?=(\\d{3})+(?!\\d))/g,'.')"`
const nowHM = () => new Date().toTimeString().slice(0, 5)

/* ═════════ Stores › Store cash ═════════
   7Soft's Kas Kecil · Modal Kasir · Setoran. Each shop's cash chain: float (Modal Kasir) → cash on
   hand → deposit in transit → bank. */

/* deposits: the day's cash goes to the shop's EDC bank the morning after, as the kartu shows it */
const DEP_LATE = { C012: '2026-10-24' }   /* Banjaran's Saturday cash went into the CRM on Sunday; BCA never showed it */
const DEP_TODAY = ['C006', 'C008']        /* deposited this morning; the other shops still hold Tuesday's cash */
const DEPS = keepSeed(() => {
  const out = []
  for (let c = '2026-10-19'; c <= addDays(TODAY, -1); c = addDays(c, 1)) STORES.forEach((s, i) => {
    if (c === addDays(TODAY, -1) && !DEP_TODAY.includes(s.code)) return
    const d = closeOf(c, s.code), date = addDays(c, 1)
    out.push({ no: `${s.code}-${c.slice(8)}`, code: s.code, close: c, date, amt: round(d.cashExp * .96, 1000), acc: GIRO_OF[s.edc], slip: `${BANKS[s.edc].short} ${4400 + i * 37 + Number(c.slice(8))}`, landed: DEP_LATE[s.code] === c || date === TODAY ? null : date, by: d.by })
  })
  return out
})
const depState = d => d.landed ? 'landed' : daysBetween(d.date, TODAY) > 1 ? 'late' : 'transit'
const DEP_WORD = { landed: ['Landed', 'ok'], transit: ['In transit', 'info'], late: ['Late', 'bad'] }
const inTransitOf = code => sumOf(DEPS.filter(d => d.code === code && !d.landed))

/* petty cash: what each shop spent in October adds up to the account's money out on Cash & Bank */
const PETTY_FOR = [['Air minum galon, 4 tabung', 72000, 96000], ['Sabun & alat kebersihan', 85000, 160000], ['Kantong sampah & tisu', 60000, 110000], ['Bensin antar setoran', 100000, 180000], ['ATK & fotokopi', 60000, 140000], ['Lampu toko', 90000, 220000], ['Konsumsi stock opname', 150000, 280000], ['Ojek ambil barang dari gudang', 40000, 80000], ['Servis AC', 250000, 400000], ['Materai & perangko', 30000, 60000]]
const PETTY = keepSeed(() => {
  const out = []
  STORES.forEach((s, i) => {
    SEED = 3100 + i * 17
    const p = boxOf('p', s.code), xs = []
    let rest = p.outM
    while (rest > 0) {
      let [w, lo, hi] = pick(PETTY_FOR)
      let amt = Math.min(rest, round(lo + rnd() * (hi - lo), 500))
      if (rest - amt < 15000) amt = rest
      if (amt < lo) w = amt < 60000 ? 'Materai & perangko' : 'Kantong sampah & tisu'
      xs.push({ w, amt, photo: rnd() < .86 }); rest -= amt
    }
    xs.forEach((x, n) => {
      const dd = Math.min(27, 1 + Math.floor((n + rnd() * .8) * 27 / xs.length))
      out.push({ code: s.code, date: `2026-10-${String(dd).padStart(2, '0')}`, for: x.w, spent: x.amt, photo: x.photo, by: PEOPLE[(i + (n % 3 === 2 ? 1 : 0)) % PEOPLE.length] })
    })
    out.push(s.code === 'C003'
      ? { code: s.code, date: '2026-10-24', for: 'Top-up from head office', top: p.inM, doc: 'BKK/HO/2610/0057', by: FIN }
      : { code: s.code, date: `2026-10-0${1 + i % 3}`, for: 'Top-up from cash on hand', top: p.inM, by: PEOPLE[i] })
  })
  const seq = {}
  out.sort((x, y) => x.date.localeCompare(y.date) || x.code.localeCompare(y.code)).forEach(x => { if (x.spent) { seq[x.code] = (seq[x.code] || 0) + 1; x.no = `KK/${x.code}/2610/${String(seq[x.code]).padStart(4, '0')}` } })
  return out.reverse()
})

function shopState(code) {
  const c = boxOf('c', code), p = boxOf('p', code), f = boxOf('f', code)
  const short = c.counted - c.books, last = [c.countedOn, p.countedOn, f.countedOn].sort()[0]
  const base = { short, last }
  if (short < 0) return { ...base, k: 'short', w: ['Short', 'bad'] }
  if (DEPS.some(d => d.code === code && depState(d) === 'late')) return { ...base, k: 'late', w: ['Deposit late', 'bad'] }
  if (short > 0) return { ...base, k: 'over', w: ['Over', 'warn'] }
  if (daysBetween(last, TODAY) > 7) return { ...base, k: 'stale', w: ['Not counted for a week', 'warn'] }
  return { ...base, k: 'ok', w: ['Counted', 'ok'] }
}
function scGo(tab, key, val) { if (key) (S.f['store-cash'] = S.f['store-cash'] || {})[key] = val; setTab('store-cash', tab) }

reg({
  id: 'store-cash', group: 'stores', label: 'Store cash',
  s7: [['Kas Kecil', 'petty'], ['Modal Kasir', 'shops'], ['Setoran', 'deposits']],
  render() {
    const id = 'store-cash', tab = tabOf(id, 'shops')
    const shops = STORES.map(s => ({ s, c: boxOf('c', s.code), p: boxOf('p', s.code), f: boxOf('f', s.code), st: shopState(s.code), tr: inTransitOf(s.code) }))
    const notLanded = DEPS.filter(d => !d.landed), deps = DEPS.filter(d => d.close >= '2026-10-23')
    const nSt = k => shops.filter(x => k === 'short' ? ['short', 'over'].includes(x.st.k) : x.st.k === k).length
    const kpis = [
      { label: 'Cash in shops', value: money(sumOf(shops, x => x.c.books + x.f.books)) },
      { label: 'In transit to banks', value: money(sumOf(notLanded)), on: "scGo('deposits')" },
      { label: 'Petty cash left', value: money(sumOf(shops, x => x.p.books)), on: "scGo('petty')" },
      { label: 'Shops short', value: String(shops.filter(x => x.st.k === 'short').length), tone: shops.some(x => x.st.k === 'short') ? 'bad' : '', on: "scGo('shops','st','short')" },
    ]
    let body
    if (tab === 'shops') {
      const f = filt(id, 'st', 'all')
      const rows = shops.filter(x => f === 'all' || (f === 'short' ? ['short', 'over'].includes(x.st.k) : x.st.k === f)).filter(x => hit(S.q[id], x.s.code, x.s.name))
      body = bar(chips(id, 'st', [['all', 'All', shops.length], ['short', 'Short or over', nSt('short')], ['late', 'Deposit late', nSt('late')], ['stale', 'Not counted', nSt('stale')]], 'all'), search(id, 'Shop'))
        + table({
          cols: [{ l: 'Shop', k: 's' }, { l: 'Float', k: 'f', num: 1, w: 130 }, { l: 'Cash on hand', k: 'c', num: 1, w: 150 }, { l: 'In transit', k: 't', num: 1, w: 150 }, { l: 'Petty cash', k: 'p', num: 1, w: 130 }, { l: 'Last counted', k: 'l', w: 120 }, { l: 'Status', k: 'st', w: 220 }],
          rows: rows.map(x => ({ on: `openShopCash('${x.s.code}')`, c: { s: shopCell(x.s.code), f: money(x.f.books), c: money(x.c.books), t: x.tr ? (x.st.k === 'late' ? `<span class="bad">${money(x.tr)}</span>` : money(x.tr)) : DASH, p: money(x.p.books), l: dayS(x.st.last), st: st(...x.st.w) } })),
          foot: { s: plural(rows.length, 'shop'), f: money(sumOf(rows, x => x.f.books)), c: money(sumOf(rows, x => x.c.books)), t: money(sumOf(rows, 'tr')), p: money(sumOf(rows, x => x.p.books)) },
          empty: 'No shop matches',
        })
    } else if (tab === 'deposits') {
      const f = filt(id, 'dst', 'all')
      const rows = deps.filter(d => f === 'all' || depState(d) === f).filter(d => hit(S.q[id], d.no, d.code, STORE[d.code].name, d.slip))
        .sort((x, y) => y.date.localeCompare(x.date) || x.code.localeCompare(y.code))
      const n = k => deps.filter(d => depState(d) === k).length
      body = bar(chips(id, 'dst', [['all', 'All', deps.length], ['transit', 'In transit', n('transit')], ['late', 'Late', n('late')], ['landed', 'Landed', n('landed')]], 'all'), search(id, 'Deposit, shop or slip'), spacer, `<span class="bar-count">${dayS('2026-10-23')} – ${dayS(addDays(TODAY, -1))} closes</span>`)
        + table({
          cols: [{ l: 'Deposit', k: 'no', w: 120 }, { l: 'Shop', k: 's' }, { l: 'Date', k: 'd', w: 100 }, { l: 'Amount', k: 'a', num: 1, w: 160 }, { l: 'Into', k: 'i', w: 150 }, { l: 'Landed', k: 'l', w: 110 }, { l: 'Status', k: 'st', w: 160 }],
          rows: rows.map(d => { const ds = depState(d); return { on: `openShopCash('${d.code}')`, c: { no: `<span class="nm">${d.no}</span>`, s: storeName(d.code), d: ds === 'late' ? `<span class="bad">${dayS(d.date)}</span>` : dayS(d.date), a: money(d.amt), i: ACC[d.acc].name, l: d.landed ? dayS(d.landed) : DASH, st: st(...DEP_WORD[ds]) } } }),
          foot: { no: plural(rows.length, 'deposit'), a: money(sumOf(rows)) },
          empty: 'No deposit matches',
        })
    } else {
      const shop = filt(id, 'shop', 'all'), k = filt(id, 'pk', 'all')
      const base = PETTY.filter(x => shop === 'all' || x.code === shop)
      const kind = x => k === 'all' || (k === 'spent' ? !!x.spent : k === 'top' ? !!x.top : x.spent && !x.photo)
      const rows = base.filter(kind).filter(x => hit(S.q[id], x.for, x.code, STORE[x.code].name, x.by, x.no, x.doc))
      body = bar(selectBox([['all', 'All shops'], ...STORES.map(s => [s.code, storeName(s.code)])], shop, `setFilt('${id}','shop',this.value)`),
        chips(id, 'pk', [['all', 'All', base.length], ['spent', 'Spent', base.filter(x => x.spent).length], ['top', 'Top-ups', base.filter(x => x.top).length], ['nophoto', 'No receipt photo', base.filter(x => x.spent && !x.photo).length]], 'all'), search(id, 'What for, shop or who'))
        + table({
          cols: [{ l: 'Date', k: 'd', w: 80 }, { l: 'Shop', k: 's', w: 160 }, { l: 'For', k: 'w' }, { l: 'Receipt', k: 'r', w: 180 }, { l: 'By', k: 'b', w: 170 }, { l: 'Spent', k: 'o', num: 1, w: 140 }, { l: 'Top-up', k: 'i', num: 1, w: 150 }],
          rows: rows.map(x => ({
            on: x.doc ? `openDoc('bkk','${x.doc}')` : `openShopCash('${x.code}')`,
            c: { d: dayS(x.date), s: shopCell(x.code), w: `<span class="one">${esc(x.for)}</span>`, r: x.doc ? tlink(x.doc, `openDoc('bkk','${x.doc}')`) : x.top ? DASH : x.photo ? tlink('Photo', "soon('The receipt photo')") : '<span class="warn">No photo</span>', b: `<span class="one">${esc(x.by)}</span>`, o: x.spent ? money(x.spent) : '', i: x.top ? money(x.top) : '' },
          })),
          foot: { d: '', s: plural(rows.length, 'line'), o: money(sumOf(rows, 'spent')), i: money(sumOf(rows, 'top')) },
          empty: 'No petty cash line matches',
        })
    }
    return page({
      title: 'Store cash', actions: [{ label: 'Record deposit', icon: 'plus', on: "scDepForm('')" }],
      tabs: [['shops', 'Shops', STORES.length], ['deposits', 'Deposits', deps.length], ['petty', 'Petty cash', PETTY.length]], tab, kpis, body,
    })
  },
})

/* one shop: what it holds, the week's chain from takings to the bank, what moved */
function shopSheet(code) {
  const s = STORE[code], i = STORES.indexOf(s), c = boxOf('c', code), p = boxOf('p', code), f = boxOf('f', code), stt = shopState(code)
  const days = []; for (let d = '2026-10-23'; d <= addDays(TODAY, -1); d = addDays(d, 1)) days.push(d)
  const chain = days.map(d => {
    const cl = closeOf(d, code), dep = DEPS.find(x => x.code === code && x.close === d), ds = dep && depState(dep)
    return {
      on: `openClose('${d}','${code}')`,
      c: {
        d: `${weekday(d)} ${dayS(d)}`, t: money(cl.cashExp),
        k: cl.counted == null ? DASH : cl.diff ? `<span class="${cl.diff < 0 ? 'bad' : 'warn'}">${money(cl.counted)}</span>` : money(cl.counted),
        n: dep ? tlink(dep.no, `openShopCash('${code}')`) : DASH, a: dep ? money(dep.amt) : DASH,
        l: !dep ? (cl.counted == null ? DASH : '<span class="mute">Not deposited yet</span>') : dep.landed ? dayS(dep.landed) : ds === 'late' ? st(lateWord(daysBetween(dep.date, TODAY)), 'bad') : st('In transit', 'info'),
      },
    }
  })
  const mv = []
  days.forEach(d => { const cl = closeOf(d, code); if (cl.counted != null) mv.push({ date: d, doc: `Daily close · ${dayS(d)}`, on: `openClose('${d}','${code}')`, box: 'Cash on hand', w: 'Cash takings', i: cl.cashExp }) })
  DEPS.filter(x => x.code === code && x.date >= '2026-10-23').forEach(x => mv.push({ date: x.date, doc: `Deposit ${x.no}`, box: 'Cash on hand', w: `To ${ACC[x.acc].name} · slip ${x.slip}`, o: x.amt }))
  PETTY.filter(x => x.code === code && x.date >= '2026-10-23').forEach(x => mv.push({ date: x.date, doc: x.doc || x.no || 'Top-up', on: x.doc ? `openDoc('bkk','${x.doc}')` : '', box: 'Petty cash', w: x.for, i: x.top, o: x.spent }))
  mv.sort((x, y) => y.date.localeCompare(x.date))
  const diff = stt.short
  return {
    shop: code, size: 'record', crumb: ['Store cash', storeName(code)], title: `${code} · ${esc(s.name)}`, pill: pill(stt.w[0], stt.w[1] === 'ok' ? '' : stt.w[1]),
    body: `${kpisHTML([{ label: 'Float', value: money(f.books) }, { label: 'Cash on hand', value: money(c.books) }, { label: 'In transit', value: money(inTransitOf(code)), tone: stt.k === 'late' ? 'bad' : '' }, { label: 'Petty cash', value: money(p.books) }, { label: 'Short or over', value: signed(diff), tone: diff < 0 ? 'bad' : diff > 0 ? 'warn' : '' }])}
      ${sec('Chain', table({
        cols: [{ l: 'Day', k: 'd', w: 120 }, { l: 'Cash takings', k: 't', num: 1, w: 160 }, { l: 'Counted', k: 'k', num: 1, w: 160 }, { l: 'Deposit', k: 'n', w: 120 }, { l: 'Deposited', k: 'a', num: 1, w: 160 }, { l: 'Landed on the bank', k: 'l' }],
        rows: chain,
      }), `<span class="mute">${dayS(days[0])} – ${dayS(days[days.length - 1])}</span>`)}
      ${sec('Movements', table({
        cols: [{ l: 'Date', k: 'd', w: 90 }, { l: 'Document', k: 'doc', w: 210 }, { l: 'Box', k: 'b', w: 140 }, { l: 'For', k: 'w' }, { l: 'In', k: 'i', num: 1, w: 150 }, { l: 'Out', k: 'o', num: 1, w: 150 }],
        rows: mv.map(m => ({ on: m.on || '', c: { d: dayS(m.date), doc: `<span class="nm">${esc(m.doc)}</span>`, b: m.box, w: `<span class="one">${esc(m.w)}</span>`, i: m.i ? money(m.i) : '', o: m.o ? money(m.o) : '' } })),
        foot: { d: '', doc: plural(mv.length, 'line'), i: money(sumOf(mv, 'i')), o: money(sumOf(mv, 'o')) },
        empty: 'Nothing moved this week',
      }), `<span class="mute">Since ${dayS(days[0])}</span>`)}
      ${facts([['Cash on hand', c.code], ['Petty cash', p.code], ['Modal Kasir', f.code], ['Head of shop', esc(PEOPLE[i])]])}`,
    foot: `<div class="foot-left">${lnk('Print', "soon('Print the shop cash')", 'printer')}</div>${btn('Record deposit', `scDepForm('${code}')`)}`,
  }
}
const openShopCash = code => openSheet(shopSheet(code))

/* record a deposit: the latest close not yet deposited fills the amount */
function scPend(code) {
  for (let d = addDays(TODAY, -1); d >= '2026-10-23'; d = addDays(d, -1)) {
    if (DEPS.some(x => x.code === code && x.close === d)) return null
    if (closeOf(d, code).counted != null) return d
  }
  return null
}
const scSug = code => { const p = scPend(code); return p ? round(closeOf(p, code).cashExp * .96, 1000) : 0 }
const bankOpts = cur => ACCOUNTS.filter(a => a.kind === 'bank' && a.name.startsWith('Giro')).map(a => `<option value="${a.id}" ${a.id === cur ? 'selected' : ''}>${esc(accLabel(a))}</option>`).join('')
function scDepForm(code) {
  const c0 = code || STORES[0].code, sug = scSug(c0)
  openSheet({
    size: 'rail', crumb: ['Store cash', code ? storeName(code) : 'Deposit'], title: 'Record deposit',
    body: `<div class="form-grid">
      ${code ? '' : field('Shop', `<select id="sc-shop" onchange="scDepShop(this.value)">${STORES.map(s => `<option value="${s.code}">${esc(storeName(s.code))}</option>`).join('')}</select>`, { req: 1, cls: 's4' })}
      ${field('Amount', `<input id="sc-amt" inputmode="numeric" placeholder="0" value="${sug ? dots(sug) : ''}" ${moneyIn()}>`, { req: 1, cls: 's4' })}
      ${field('Into', `<select id="sc-acc">${bankOpts(GIRO_OF[STORE[c0].edc])}</select>`, { cls: 's4' })}
      ${field('Slip no', `<input id="sc-slip" placeholder="On the bank's slip">`, { cls: 's2' })}
      ${field('Date', `<input id="sc-date" type="date" value="${TODAY}">`, { cls: 's2' })}</div>`,
    foot: btn('Save deposit', `scDepSave('${code}')`),
  })
}
function scDepShop(code) { const s = scSug(code); $('#sc-amt').value = s ? dots(s) : ''; $('#sc-acc').value = GIRO_OF[STORE[code].edc] }
function scDepSave(fixed) {
  const code = fixed || $('#sc-shop').value, amt = parseRp($('#sc-amt').value), acc = $('#sc-acc').value, slip = $('#sc-slip').value.trim(), date = $('#sc-date').value || TODAY
  const c = boxOf('c', code), bad = !amt || amt > c.books
  $('#sc-amt').closest('.f7').classList.toggle('err', bad)
  if (bad) { toast(amt ? `More than the cash on hand at ${code}` : 'Type the amount', amt ? money(c.books) + ' on hand' : '', 'bad'); return }
  const close = scPend(code) || date
  let no = `${code}-${close.slice(8)}`
  while (DEPS.some(x => x.no === no)) no += 'b'
  DEPS.push({ no, code, close, date, amt, acc, slip: slip || '—', landed: null, by: PEOPLE[STORES.indexOf(STORE[code])] })
  c.books -= amt; c.counted -= amt; ACC[acc].books += amt
  toast(`Deposit ${no} recorded`, `${money(amt)} in transit to ${ACC[acc].name}`)
  closeSheet()
  setTimeout(() => { const top = S.stack[S.stack.length - 1]; if (top && top.shop === code) refreshSheet(shopSheet(code)); render() }, 220)
}

/* ═════════ Cash & Bank › Giro ═════════
   BG Keluar from writing to clearing: what is already promised out of which bank, and when.
   Every BG is written by a BKK; Saldo Awal BG are the ones still out when the books opened. */
const allGiros = () => [...GIROS, ...GIRO_OPENING]
const isOpening = g => GIRO_OPENING.includes(g)
const giroAcc = g => g.acc || GIRO_OF[g.bank]
const giroBy = no => allGiros().find(g => g.no === no)
const giroOut = g => g.state === 'written' || g.state === 'with'
const giroLate = g => g.state === 'with' && g.due < TODAY
const giroWord = g => giroLate(g) ? [lateWord(daysBetween(g.due, TODAY)), 'bad'] : GIROWORD[g.state]
/* the account's books, less every BG still out that falls due on or before this one */
function giroBalance(g) {
  if (!giroOut(g)) return null
  const a = ACC[giroAcc(g)]
  return a.books - sumOf(allGiros().filter(x => giroOut(x) && giroAcc(x) === giroAcc(g) && (x.due < g.due || (x.due === g.due && x.no <= g.no))))
}
const giroBill = g => g.bkk && BILLS.find(b => b.bounced === g.bkk)
function giroAction(g, sheet) {
  if (g.state === 'written') return btn('Given to supplier', `grGive('${g.no}')`)
  if (g.state === 'with') return g.onStatement ? btn('Match bank line', `grMatch('${g.no}')`) : btn('Mark cleared', `grClear('${g.no}')`)
  if (g.state === 'bounced') return btn('Replace', `grReplace('${g.no}')`)
  return sheet && g.bkk && docOf(g.bkk) ? btn('Open BKK', `openDoc('bkk','${g.bkk}')`) : ''
}
function giroCard(g) {
  const bal = giroBalance(g), bill = giroBill(g)
  const when = g.state === 'cleared' ? `Cleared ${dayS(g.cleared)}` : g.state === 'bounced' ? `<span class="bad">Bounced ${dayS(g.bounced)}</span>` : giroLate(g) ? `<span class="bad">${lateWord(daysBetween(g.due, TODAY))}</span> · due ${dayS(g.due)}` : `Due ${dayS(g.due)}`
  const act = giroAction(g)
  return `<div class="bcard" role="button" tabindex="0" onclick="openGiro('${g.no}')">
    <div class="nm one">${esc(SUP[g.sup].name)}</div>
    <div class="bc-amt" style="margin-top:4px">${money(g.amt)}</div>
    <div class="bc-sub">BG ${g.no} · ${g.bank}${isOpening(g) ? ' · Saldo Awal' : ''}</div>
    <div class="bc-sub">${when}</div>
    ${bal != null ? `<div class="bc-sub">Balance on due date</div><div class="ds-num ${bal < 0 ? 'bad' : ''}">${money(bal)}</div>` : ''}
    ${bill ? `<div class="bc-sub">${bill.no} open again</div>` : ''}
    ${act ? `<div class="bc-act">${act}</div>` : ''}</div>`
}
function grList(k) { (S.f.giro = S.f.giro || {}).gk = k; setTab('giro', 'list') }

reg({
  id: 'giro', group: 'cash', label: 'Giro',
  s7: [['Pencairan BG Keluar'], ['Pencairan BG'], ['Saldo Awal BG', 'opening']],
  render() {
    const id = 'giro', tab = tabOf(id, 'board'), gs = allGiros()
    const out = gs.filter(giroOut), week = out.filter(g => g.due >= TODAY && g.due <= addDays(TODAY, 6)), late = gs.filter(giroLate), bounced = gs.filter(g => g.state === 'bounced')
    const kpis = [
      { label: 'Will leave the bank', value: money(sumOf(out)) },
      { label: 'Due this week', value: `${week.length} · ${money(sumOf(week))}`, on: "grList('week')" },
      { label: 'Late', value: `${late.length} · ${money(sumOf(late))}`, tone: late.length ? 'bad' : '', on: "grList('late')" },
      { label: 'Bounced', value: `${bounced.length} · ${money(sumOf(bounced))}`, tone: bounced.length ? 'bad' : '', on: "grList('bounced')" },
    ]
    let body
    if (tab === 'board') {
      const byDue = (x, y) => x.due.localeCompare(y.due)
      const lanes = [
        ['Written', gs.filter(g => g.state === 'written').sort(byDue)],
        ['With supplier', gs.filter(g => g.state === 'with').sort(byDue)],
        ['Cleared · October', gs.filter(g => g.state === 'cleared' && g.cleared >= '2026-10-01').sort((x, y) => y.cleared.localeCompare(x.cleared))],
        ['Bounced', bounced],
      ]
      body = `<div class="board">${lanes.map(([t, xs]) => `<div class="lane"><div class="lane-h"><b>${t}</b><span>${xs.length}</span></div><div class="mute ds-num" style="padding:0 4px 12px;margin-top:-6px">${money(sumOf(xs))}</div>${xs.map(giroCard).join('') || '<div class="mute" style="padding:6px 4px 10px">None</div>'}</div>`).join('')}</div>`
    } else if (tab === 'list') {
      const f = filt(id, 'gk', 'all')
      const test = { all: () => true, written: g => g.state === 'written', with: g => g.state === 'with', week: g => week.includes(g), late: giroLate, cleared: g => g.state === 'cleared', bounced: g => g.state === 'bounced' }
      const rank = g => giroOut(g) ? 0 : g.state === 'bounced' ? 1 : 2
      const rows = gs.filter(test[f] || test.all).filter(g => hit(S.q[id], g.no, SUP[g.sup].name, g.bkk, g.bank))
        .sort((x, y) => rank(x) - rank(y) || (rank(x) ? y.due.localeCompare(x.due) : x.due.localeCompare(y.due)))
      body = bar(chips(id, 'gk', [['all', 'All', gs.length], ['written', 'Written', gs.filter(test.written).length], ['with', 'With supplier', gs.filter(test.with).length], ['week', 'Due this week', week.length], ['late', 'Late', late.length], ['cleared', 'Cleared', gs.filter(test.cleared).length], ['bounced', 'Bounced', bounced.length]], 'all'), search(id, 'BG no, supplier or BKK'))
        + table({
          cols: [{ l: 'Due', k: 'd', w: 90 }, { l: 'BG no', k: 'no', w: 100 }, { l: 'Supplier', k: 's' }, { l: 'Account', k: 'a', w: 140 }, { l: 'Amount', k: 'm', num: 1, w: 160 }, { l: 'Status', k: 'st', w: 160 }, { l: 'Balance on due date', k: 'b', num: 1, w: 190 }],
          rows: rows.map(g => { const bal = giroBalance(g); return { on: `openGiro('${g.no}')`, c: { d: giroLate(g) ? `<span class="bad">${dayS(g.due)}</span>` : dayS(g.due), no: `<span class="nm">${g.no}</span>`, s: `<span class="one">${esc(SUP[g.sup].name)}</span>`, a: ACC[giroAcc(g)].name, m: money(g.amt), st: st(...giroWord(g)), b: bal == null ? DASH : bal < 0 ? `<span class="bad">${money(bal)}</span>` : money(bal) } } }),
          foot: { d: '', no: plural(rows.length, 'BG'), m: money(sumOf(rows)) },
          empty: 'No BG matches',
        })
    } else {
      body = table({
        cols: [{ l: 'BG no', k: 'no', w: 110 }, { l: 'Bank', k: 'bk', w: 110 }, { l: 'Supplier', k: 's' }, { l: 'Due', k: 'd', w: 100 }, { l: 'Cleared', k: 'c', w: 100 }, { l: 'Amount', k: 'm', num: 1, w: 160 }, { l: 'Status', k: 'st', w: 160 }],
        rows: GIRO_OPENING.map(g => ({ on: `openGiro('${g.no}')`, c: { no: `<span class="nm">${g.no}</span>`, bk: g.bank, s: `<span class="one">${esc(SUP[g.sup].name)}</span>`, d: giroLate(g) ? `<span class="bad">${dayS(g.due)}</span>` : dayS(g.due), c: g.cleared ? dayS(g.cleared) : DASH, m: money(g.amt), st: st(...giroWord(g)) } })),
        foot: { no: plural(GIRO_OPENING.length, 'BG'), m: money(sumOf(GIRO_OPENING)) },
        empty: 'No giro was out on 1 Oct 2026',
      })
    }
    return page({
      title: 'Giro',
      actions: tab === 'opening' ? [{ label: 'Add opening giro', icon: 'plus', on: 'grOpenForm()' }] : [{ label: 'Write giro', icon: 'plus', on: 'grWrite()' }],
      tabs: [['board', 'Board', out.length + bounced.length], ['list', 'List', gs.length], ['opening', 'Opening giro', GIRO_OPENING.length]], tab, kpis, body,
    })
  },
})

function giroSheet(no) {
  const g = giroBy(no), s = SUP[g.sup], a = ACC[giroAcc(g)], [w, tone] = giroWord(g), bal = giroBalance(g), bill = giroBill(g), v = g.bkk && docOf(g.bkk)
  const bkk = g.bkk ? (v ? tlink(g.bkk, `openDoc('bkk','${g.bkk}')`) : esc(g.bkk)) : 'Saldo Awal BG'
  const steps = [
    ...(g.written ? [['Written', g.written, 'ok', g.bkk ? `${g.bkk} · ${FIN}` : FIN]] : [['Saldo Awal BG', '2026-10-01', 'ok', 'Still out when the books opened']]),
    ...(isOpening(g) && !g.given ? [] : [['Given to supplier', g.given, g.given ? 'ok' : '', g.given ? `To ${esc(s.contact)}` : '']]),
    ['Due', g.due, g.state === 'cleared' || g.state === 'bounced' ? 'ok' : giroLate(g) ? 'bad' : '', bal != null ? `Balance on due date ${money(bal)}` : ''],
    g.state === 'bounced' ? ['Bounced', g.bounced, 'bad', esc(g.why || '')] : ['Cleared', g.cleared, g.cleared ? 'ok' : '', g.cleared ? `KLIRING BG ${g.no} · ${a.name}` : g.onStatement ? `On the ${a.name} statement, not matched` : ''],
  ]
  const banner = g.state === 'bounced' ? `<div class="banner bad">${ico('alert')}<span>Bounced on ${day(g.bounced)}${g.why ? ` — ${esc(g.why)}` : ''}.${bill ? ` ${bill.no} is open again.` : ''}</span></div>`
    : bal != null && bal < 0 ? `<div class="banner bad">${ico('alert')}<span>${a.name} is ${money(-bal)} short on ${day(g.due)}. The BG bounces if the money is not there.</span></div>`
      : g.onStatement && g.state === 'with' ? `<div class="banner info">${ico('check')}<span>KLIRING BG ${g.no} is on the ${a.name} statement. Matching it clears the BG.</span></div>` : ''
  return {
    giro: no, size: 'wide', crumb: ['Giro', a.name], title: `BG ${g.no}`, pill: pill(w, tone),
    body: `${banner}${facts([['BG no', g.no], ['Bank', g.bank], ['Account', `${a.name} · ${a.no}`], ['BKK', bkk], ['Supplier', esc(s.name)], ['Amount', money(g.amt)], ['Written', g.written ? day(g.written) : '—'], ['Given', g.given ? day(g.given) : '—'], ['Due', day(g.due)], g.state === 'bounced' ? ['Bounced', day(g.bounced)] : ['Cleared', g.cleared ? day(g.cleared) : '—'], ...(bal != null ? [['Balance on due date', bal < 0 ? `<span class="bad">${money(bal)}</span>` : money(bal)]] : []), ...(bill ? [['Bill', tlink(bill.no, `go('bills');setTimeout(function(){window.openBill&&openBill('${bill.no}')},30)`)]] : [])])}
      ${sec('Timeline', table({
        cols: [{ l: 'Step', k: 's', w: 220 }, { l: 'Date', k: 'd', w: 150 }, { l: 'Note', k: 'n' }],
        rows: steps.map(([t, d, tn, n]) => ({ cls: d ? '' : 'dim', c: { s: st(t, tn), d: d ? day(d) : DASH, n: `<span class="one mute">${n}</span>` } })),
      }))}`,
    foot: `<div class="foot-left">${lnk('Print', "soon('Print the BG')", 'printer')}</div>${giroAction(g, true)}`,
  }
}
const openGiro = no => { if (giroBy(no)) openSheet(giroSheet(no)) }
function grDone(no, title, desc) {
  toast(title, desc)
  const top = S.stack[S.stack.length - 1]
  if (top && top.giro === no) refreshSheet(giroSheet(no))
  render()
}
function grGive(no) { const g = giroBy(no); g.state = 'with'; g.given = TODAY; grDone(no, `BG ${no} given to ${SUP[g.sup].name}`, `${money(g.amt)} · due ${day(g.due)}`) }
function grClear(no) { const g = giroBy(no); g.state = 'cleared'; g.cleared = TODAY; grDone(no, `BG ${no} cleared`, `${money(g.amt)} out of ${ACC[giroAcc(g)].name}`) }
function grMatch(no) { const g = giroBy(no); S.f['bank-rec'] = { acc: giroAcc(g), show: 'to' }; go('bank-rec') }
/* a bounced BG: a new BKK by giro for the same supplier, the bill it paid already ticked */
function grReplace(no) {
  const g = giroBy(no), d = draftOf('bkk', 'new'), bill = giroBill(g)
  d.party = g.sup; d.acc = giroAcc(g); d.method = 'giro'; d.giro = { no: '', bank: ACC[d.acc].bank, due: '' }
  d.rows = settleRowsFor(d, null); d.offs = []
  d.rows.forEach(r => { if (bill && r.no === bill.no) { r.pick = true; r.amt = r.open } })
  d.tab = 'settle'; d.note = `Replaces BG ${g.no}`
  openDoc('bkk', 'new')
}
function grWrite() { const d = draftOf('bkk', 'new'); d.method = 'giro'; openDoc('bkk', 'new') }
function grOpenForm() {
  openSheet({
    size: 'rail', crumb: ['Giro', 'Saldo Awal BG'], title: 'Add opening giro',
    body: `<div class="form-grid">
      ${field('BG no', '<input id="og-no" placeholder="456118">', { req: 1, cls: 's2' })}
      ${field('Bank', `<select id="og-bank">${['BCA', 'Mandiri', 'BRI'].map(b => `<option>${b}</option>`).join('')}</select>`, { cls: 's2' })}
      ${field('Supplier', `<select id="og-sup"><option value="">Pick a supplier</option>${SUPPLIERS.map(s => `<option value="${s.code}">${esc(s.name)} · ${s.code}</option>`).join('')}</select>`, { req: 1, cls: 's4' })}
      ${field('Amount', `<input id="og-amt" inputmode="numeric" placeholder="0" ${moneyIn()}>`, { req: 1, cls: 's2' })}
      ${field('Due date', '<input id="og-due" type="date">', { req: 1, cls: 's2' })}</div>`,
    foot: btn('Save opening giro', 'grOpenSave()'),
  })
}
function grOpenSave() {
  const no = $('#og-no').value.trim(), bank = $('#og-bank').value, sup = $('#og-sup').value, amt = parseRp($('#og-amt').value), due = $('#og-due').value
  const err = { 'og-no': !no || !!giroBy(no), 'og-sup': !sup, 'og-amt': !amt, 'og-due': !due }
  Object.entries(err).forEach(([k, v]) => $('#' + k).closest('.f7').classList.toggle('err', v))
  if (Object.values(err).some(Boolean)) { if (no && giroBy(no)) toast(`BG ${no} is already in the books`, '', 'bad'); return }
  GIRO_OPENING.push({ no, bank, sup, amt, due, state: 'with', given: '2026-09-30' })
  window.PAL_DOCS.push({ doc: 1, t: `BG ${no} · ${SUP[sup].name}`, g: 'Giro', go: () => { go('giro'); setTimeout(() => openGiro(no), 30) } })
  closeSheet(); render()
  toast(`BG ${no} added to Saldo Awal BG`, `${SUP[sup].name} · ${money(amt)} · due ${day(due)}`)
}

/* ═════════ Cash & Bank › Bank reconciliation ═════════
   7Soft's Rekonsiliasi Bank, laid out as the bank prints the statement: every line, the running
   balance, and what it is in the books. Card and QRIS are booked straight to the EDC bank's Cash in Bank (owner, 1 Oct);
   matching a credit to its Daily close books the MDR fee to 6010310004. */
const REC = { done: {}, booked: {}, lastF: null }
/* lines the bank shows that nobody has matched yet, and what the bank took on its own */
const REC_SET = {
  bca: {
    match: ['BKK/HO/2610/0058', 'BKK/HO/2610/0060', 'BKM/HO/2610/0024', 'C003-26'],
    own: [['2026-10-22', 'BIAYA BUKU BG 25 LBR', -117000, 'Buku BG 25 lembar'], ['2026-10-25', 'BIAYA TRSF BI-FAST 2510/WS95058', -2500, 'BI-FAST transfer ke Graha Clean']],
  },
  mdr: {
    match: ['BKM/HO/2610/0021', 'C013-26'],
    own: [['2026-10-26', 'BIAYA ADM GIRO 10/2026', -30000, 'Adm giro Mandiri Oktober'], ['2026-10-27', 'BIAYA MCM 10/2026', -50000, 'Mandiri Cash Management Oktober']],
  },
  bcat: { own: [['2026-10-27', 'BUNGA', 362300, 'Bunga tabungan Oktober']] },
}
const BANKTXT = {
  BCA: { db: 'TRSF E-BANKING DB', cr: 'TRSF E-BANKING CR', ref: (v, d) => `${d}/FTSCY/WS95${v.no.slice(-3)}`, dep: 'SETOR TUNAI', edc: 'KR EDC BCA', mid: '885' },
  Mandiri: { db: 'MCM INHOUSETRF DB', cr: 'MCM INHOUSETRF CR', ref: (v, d) => `${d}${v.no.slice(-4)}`, dep: 'SETORAN TUNAI', edc: 'KR EDC MANDIRI', mid: '710' },
  BRI: { db: 'TRF DB', cr: 'TRF CR', ref: (v, d) => `${d}${v.no.slice(-3)}`, dep: 'SETOR TUNAI', edc: 'KR EDC BRI', mid: '002' },
}
const recBanks = () => ACCOUNTS.filter(a => a.kind === 'bank' && !a.upload)
function vDesc(v, m, T) {
  const o = (v.other || [])[0], d = v.date.slice(8) + v.date.slice(5, 7)
  if (m === 'bkk' && o && o[0] === '6010310004') return 'BIAYA ADM'
  if (m === 'bkm' && o && o[0] === '8010110001') return 'BUNGA JASA GIRO'
  const who = v.party ? SUP[v.party].name.replace(/,\s*(PT|CV)$/i, '') : v.ref && !/^TRF/.test(v.ref) ? v.ref : v.what
  return `${m === 'bkk' ? T.db : T.cr} ${T.ref(v, d)} ${who.toUpperCase()}`
}
function lineState(l, set) {
  const s = l.src, m = set.match || []
  if (s.t === 'edc') return { st: 'ok', doc: [`Close ${s.code} · ${dayS(s.close)}`, `openClose('${s.close}','${s.code}')`] }
  if (s.t === 'dep') return { st: m.includes(s.x.no) && !REC.done[l.id] ? 'match' : 'ok', doc: [`Deposit ${s.x.no}`, `openShopCash('${s.x.code}')`] }
  if (s.t === 'v') return { st: m.includes(s.v.no) && !REC.done[l.id] ? 'match' : 'ok', doc: [s.v.no, `openDoc('${s.m}','${s.v.no}')`] }
  if (s.t === 'giro') return { st: s.g.state === 'with' ? 'match' : 'ok', doc: [`BG ${s.g.no}`, `openGiro('${s.g.no}')`] }
  const no = REC.booked[l.id]
  return no ? { st: 'ok', doc: [no, `openDoc('${s.m}','${no}')`] } : { st: 'book', doc: null }
}
/* the statement of one account, 20–27 Oct, built from the shared books so every figure agrees */
function stmtOf(id) {
  return keepSeed(() => {
    const a = ACC[id], T = BANKTXT[a.bank], set = REC_SET[id] || {}, from = addDays(a.stmt, -7), L = []
    const inWin = d => d >= from && d <= a.stmt
    if (a.name.startsWith('Giro')) STORES.filter(s => s.edc === a.bank).forEach((s, i) => {
      for (let d = from; d <= a.stmt; d = addDays(d, 1)) {
        const c = addDays(d, -1), e = edcOf(c, s.code)
        if (e.net > 0) L.push({ id: `edc-${s.code}-${c}`, date: d, ord: 1, desc: `${T.edc} ${c.slice(8)}/${c.slice(5, 7)} MID ${T.mid}${String(1003 + Number(s.loc) * 217).padStart(5, '0')}`, dr: 0, cr: e.net, src: { t: 'edc', code: s.code, close: c, e } })
      }
    })
    DEPS.filter(x => x.acc === id && x.landed && inWin(x.landed)).forEach(x => L.push({ id: 'dep-' + x.no, date: x.landed, ord: 2, desc: `${T.dep} ${x.code}`, dr: 0, cr: x.amt, src: { t: 'dep', x } }))
    ;['bkk', 'bkm'].forEach(m => VOUCHERS[m].filter(v => v.acc === id && v.st === 'posted' && v.method !== 'giro' && inWin(v.date))
      .forEach(v => L.push({ id: 'v-' + v.no, date: v.date, ord: 3, desc: vDesc(v, m, T), dr: m === 'bkk' ? v.amt : 0, cr: m === 'bkm' ? v.amt : 0, src: { t: 'v', m, v } })))
    allGiros().filter(g => giroAcc(g) === id && ((g.state === 'cleared' && inWin(g.cleared)) || (g.state === 'with' && g.onStatement)))
      .forEach(g => L.push({ id: 'bg-' + g.no, date: g.state === 'cleared' ? g.cleared : g.due, ord: 4, desc: `KLIRING BG ${g.no}`, dr: g.amt, cr: 0, src: { t: 'giro', g } }))
    ;(set.own || []).forEach(([d, desc, amt, note], i) => L.push({ id: `own-${id}-${i}`, date: d, ord: 5, desc, dr: amt < 0 ? -amt : 0, cr: amt > 0 ? amt : 0, src: { t: 'own', note, m: amt < 0 ? 'bkk' : 'bkm', gl: amt < 0 ? '6010310004' : '8010110001' } }))
    L.sort((x, y) => x.date.localeCompare(y.date) || x.ord - y.ord || x.desc.localeCompare(y.desc))
    let bal = a.bankBal - sumOf(L, l => l.cr - l.dr)
    const open = bal
    L.forEach(l => { bal += l.cr - l.dr; l.bal = bal; Object.assign(l, lineState(l, set)) })
    /* in the books, not at the bank yet: BG given and booked but not cleared, deposits not landed */
    const outs = [
      ...allGiros().filter(g => giroAcc(g) === id && g.state === 'with' && !g.onStatement && (!g.bkk || !docOf(g.bkk) || docOf(g.bkk).st === 'posted')).sort((x, y) => x.due.localeCompare(y.due))
        .map(g => ({ t: 'giro', g, date: g.due, desc: `BG ${g.no} · ${SUP[g.sup].name}`, dr: g.amt, cr: 0, late: giroLate(g), doc: g.bkk && docOf(g.bkk) ? [g.bkk, `openDoc('bkk','${g.bkk}')`] : [`BG ${g.no}`, `openGiro('${g.no}')`], on: `openGiro('${g.no}')` })),
      ...DEPS.filter(x => x.acc === id && !x.landed).sort((x, y) => x.date.localeCompare(y.date))
        .map(x => ({ t: 'dep', x, date: x.date, desc: `${T.dep} ${x.code} · deposit ${x.no}`, dr: 0, cr: x.amt, late: depState(x) === 'late', doc: [`Deposit ${x.no}`, `openShopCash('${x.code}')`], on: `openShopCash('${x.code}')` })),
    ]
    return { a, from, open, lines: L, outs }
  })
}
/* bank − books − to match = 0, shown only on the printout */
function recSums(id) {
  const s = stmtOf(id), a = s.a
  const own = s.lines.filter(l => l.st === 'book'), gir = s.outs.filter(o => o.t === 'giro'), dep = s.outs.filter(o => o.t === 'dep')
  const ownNet = sumOf(own, l => l.cr - l.dr), giroNet = sumOf(gir, 'dr'), depNet = sumOf(dep, 'cr')
  const toMatch = ownNet + giroNet - depNet
  return { s, own, gir, dep, ownNet, giroNet, depNet, toMatch, diff: a.bankBal - a.books - toMatch }
}
const syncMatch = id => { ACC[id].toMatch = stmtOf(id).lines.filter(l => l.st !== 'ok').length }

reg({
  id: 'bank-rec', group: 'cash', label: 'Bank reconciliation',
  s7: [['Rekonsiliasi Bank']],
  badge: () => { const n = sumOf(recBanks(), 'toMatch'); return n ? [n] : null },
  render() { const acc = filt('bank-rec', 'acc', ''); return acc && ACC[acc] ? recPage(ACC[acc]) : recList() },
  after() { REC.lastF = S.f['bank-rec'] || null },
})
function rcOpen(id) { S.f['bank-rec'] = { acc: id }; window.scrollTo(0, 0); render() }
function recList() {
  const banks = ACCOUNTS.filter(a => a.kind === 'bank'), up = banks.filter(a => a.upload)
  const kpis = [
    { label: 'Lines to match', value: String(sumOf(recBanks(), 'toMatch')) },
    { label: 'Accounts with a difference', value: String(banks.filter(a => !a.upload && a.bankBal !== a.books).length) },
    { label: 'Statements to upload', value: String(up.length), tone: up.length ? 'warn' : '' },
  ]
  return page({
    title: 'Bank reconciliation', kpis,
    body: table({
      cols: [{ l: 'Account', k: 'a' }, { l: 'Statement date', k: 'd', w: 140 }, { l: 'Bank', k: 'b', num: 1, w: 170 }, { l: 'Books', k: 'k', num: 1, w: 170 }, { l: 'Difference', k: 'x', num: 1, w: 150 }, { l: 'To match', k: 'm', cls: 'act', w: 190 }],
      rows: banks.map(a => {
        const d = a.bankBal - a.books
        return { on: `rcOpen('${a.id}')`, c: { a: `<span class="nm">${a.name}</span> <span class="mute">${a.no}</span>`, d: a.upload ? `<span class="warn">${dayS(a.stmt)}</span>` : dayS(a.stmt), b: money(a.bankBal), k: money(a.books), x: d ? signed(d) : '<span class="mute">0</span>', m: a.upload ? cellBtn('Upload statement', `soon('Upload the ${a.name} statement')`) : left(a.toMatch ? String(a.toMatch) : '<span class="mute">0</span>') } }
      }),
    }),
  })
}
function recBooks(l) {
  if (l.st === 'ok') return left(tlink(esc(l.doc[0]), l.doc[1], 1))
  if (l.st === 'match') return left(lnk('Match', `rcLine('${l.acc}','${l.id}')`))
  return cellBtn(`Book ${l.src.m.toUpperCase()}`, `rcBook('${l.acc}','${l.id}')`)
}
function recPage(a) {
  const id = 'bank-rec', crumb = ['Bank reconciliation', "rcOpen('')"], title = `${a.name} · ${a.no}`, codePill = `<span class="code">${a.code}</span>`
  const upload = { raw: lnk('Upload statement', `soon('Upload the ${a.name} statement')`, 'download') }
  if (a.upload) return page({ crumb, title, pill: codePill, actions: [{ label: 'Upload statement', icon: 'download', on: `soon('Upload the ${a.name} statement')` }], kpis: [{ label: `Bank · ${dayS(a.stmt)}`, value: money(a.bankBal) }, { label: 'Books', value: money(a.books) }], body: `<div class="ds-table-card"><div class="empty-note">No statement since ${day(a.stmt)}</div></div>` })
  const s = stmtOf(a.id), show = filt(id, 'show', 'all'), qq = S.q[id] || ''
  s.lines.forEach(l => { l.acc = a.id })
  const toN = s.lines.filter(l => l.st !== 'ok').length, okN = s.lines.length - toN
  const rows = s.lines.filter(l => show === 'all' || (show === 'to' ? l.st !== 'ok' : l.st === 'ok')).filter(l => hit(qq, l.desc, l.doc && l.doc[0], dots(l.dr || l.cr)))
  const whole = show === 'all' && !qq
  const stmtCols = [{ l: 'Date', k: 'd', w: 80 }, { l: 'Description', k: 'w' }, { l: 'Debit', k: 'dr', num: 1, w: 150 }, { l: 'Credit', k: 'cr', num: 1, w: 150 }, { l: 'Balance', k: 'b', num: 1, w: 170 }, { l: 'In the books', k: 'm', cls: 'act', w: 220 }]
  const stmt = table({
    tbl: 'stmt', cols: stmtCols,
    rows: [...(whole ? [{ cls: 'dim', c: { d: dayS(s.from), w: 'SALDO AWAL', b: money(s.open) } }] : []),
      ...rows.map(l => ({ on: `rcLine('${a.id}','${l.id}')`, c: { d: dayS(l.date), w: `<span class="one">${esc(l.desc)}</span>`, dr: l.dr ? money(l.dr) : '', cr: l.cr ? money(l.cr) : '', b: money(l.bal), m: recBooks(l) } }))],
    foot: whole ? { d: '', w: plural(s.lines.length, 'line'), dr: money(sumOf(s.lines, 'dr')), cr: money(sumOf(s.lines, 'cr')), b: money(a.bankBal) } : null,
    empty: show === 'to' ? 'Every line is matched' : 'No line matches',
  })
  const outs = s.outs.filter(o => !qq || hit(qq, o.desc, o.doc[0]))
  const outTable = show !== 'ok' && outs.length ? sec('In the books, not at the bank yet', table({
    tbl: 'stmt', cols: stmtCols.map(c => c.k === 'b' ? { ...c, l: 'Status', num: 0 } : c),
    rows: outs.map(o => ({ on: o.on, c: { d: o.late ? `<span class="bad">${dayS(o.date)}</span>` : dayS(o.date), w: `<span class="one">${esc(o.desc)}</span>`, dr: o.dr ? money(o.dr) : '', cr: o.cr ? money(o.cr) : '', b: o.t === 'giro' ? (o.late ? st(lateWord(daysBetween(o.date, TODAY)), 'bad') : st('With supplier', 'info')) : st(...DEP_WORD[depState(o.x)]), m: left(tlink(esc(o.doc[0]), o.doc[1], 1)) } })),
    foot: { d: '', w: plural(outs.length, 'line'), dr: money(sumOf(outs, 'dr')), cr: money(sumOf(outs, 'cr')) },
  })) : ''
  return page({
    crumb, title, pill: codePill,
    actions: [{ raw: lnk('Print', `rcPrint('${a.id}')`, 'printer') }, upload],
    kpis: [{ label: `Bank · ${dayS(a.stmt)}`, value: money(a.bankBal) }, { label: 'Books', value: money(a.books) }, { label: 'To match', value: String(toN), on: `setFilt('${id}','show','to')` }, { label: 'Matched', value: String(okN), on: `setFilt('${id}','show','ok')` }],
    body: bar(chips(id, 'show', [['all', 'All', s.lines.length], ['to', 'To match', toN], ['ok', 'Matched', okN]], 'all'), search(id, 'Description, document or amount'), spacer, `<span class="bar-count">${dayS(s.from)} – ${day(a.stmt)}</span>`)
      + `<div class="sec">${stmt}</div>${outTable}`,
  })
}

/* one bank line: what it is in the books, or what would be */
const ladder = (rows, tot) => `<div class="ladder" style="max-width:none;margin:0">${rows.map(([t, v, cls]) => `<div class="${cls || ''}"><span class="${cls === 'tot' ? '' : 'mute'}">${t}</span><span>${v}</span></div>`).join('')}${tot ? `<div class="tot"><span>${tot[0]}</span><span>${tot[1]}</span></div>` : ''}</div>`
function lineSheet(accId, lineId) {
  const s = stmtOf(accId), a = s.a, l = s.lines.find(x => x.id === lineId)
  if (!l) return null
  const amt = l.dr || l.cr, x = l.src
  const bank = sec('At the bank', facts2([['Date', day(l.date)], [l.dr ? 'Debit' : 'Credit', money(amt)], ['Balance after', money(l.bal)], ['Statement', `${a.name} · ${day(a.stmt)}`]]))
  let books
  if (x.t === 'edc') books = sec('In the books', `${facts2([['Daily close', tlink(`${x.code} · ${day(x.close)}`, `openClose('${x.close}','${x.code}')`)], ['Shop', esc(storeName(x.code))]])}
    ${ladder([[`Card & QRIS takings`, money(x.e.gross)], [`Fee · MDR · 6010310004 ${GL['6010310004']}`, money(-x.e.fee)]], ['Bank credit', money(x.e.net)])}`)
  else if (x.t === 'dep') books = sec('In the books', facts2([['Deposit', tlink(x.x.no, `openShopCash('${x.x.code}')`)], ['Shop', esc(storeName(x.x.code))], ['Deposited', day(x.x.date)], ['Slip', esc(x.x.slip)], ['Amount', money(x.x.amt)], ['From', `Cash on Hand · ${x.x.code}`]]))
  else if (x.t === 'v') books = sec('In the books', facts2([[x.m.toUpperCase(), tlink(x.v.no, `openDoc('${x.m}','${x.v.no}')`)], ['Date', day(x.v.date)], [x.v.party ? (x.m === 'bkk' ? 'Paid to' : 'Received from') : 'For', esc(x.v.party ? SUP[x.v.party].name : x.v.what)], ['Amount', money(x.v.amt)]]))
  else if (x.t === 'giro') { const v = docOf(x.g.bkk); books = sec('In the books', facts2([['BG', tlink(x.g.no, `openGiro('${x.g.no}')`)], ['BKK', v ? tlink(x.g.bkk, `openDoc('bkk','${x.g.bkk}')`) : esc(x.g.bkk || 'Saldo Awal BG')], ['Supplier', esc(SUP[x.g.sup].name)], ['Amount', money(x.g.amt)], ['Due', day(x.g.due)], ['Status', st(...giroWord(x.g))]])) }
  else books = sec('In the books', l.st === 'ok' ? facts2([[x.m.toUpperCase(), tlink(l.doc[0], l.doc[1])], ['Account', `${x.gl} ${GL[x.gl]}`]]) : ladder([[`${x.m.toUpperCase()} · ${x.gl} ${GL[x.gl]}`, money(amt)]], ['Not in the books yet', money(amt)]))
  const [w, tone] = l.st === 'ok' ? ['Matched', 'ok'] : l.st === 'match' ? ['To match', 'info'] : ['Bank only', 'warn']
  const foot = l.st === 'match' ? btn('Confirm match', `rcConfirm('${accId}','${lineId}')`) : l.st === 'book' ? btn(`Book ${x.m.toUpperCase()}`, `rcBook('${accId}','${lineId}')`) : btn(`Open ${esc(l.doc[0])}`, l.doc[1])
  return { line: lineId, size: 'rail', crumb: ['Bank reconciliation', a.name], title: esc(l.desc), pill: pill(w, tone), body: bank + books, foot }
}
function rcLine(accId, lineId) { const o = lineSheet(accId, lineId); if (o) openSheet(o) }
function rcConfirm(accId, lineId) {
  const l = stmtOf(accId).lines.find(x => x.id === lineId)
  if (l.src.t === 'giro') { const g = l.src.g; g.state = 'cleared'; g.cleared = l.date; delete g.onStatement } else REC.done[lineId] = true
  syncMatch(accId)
  if (S.stack.length) closeSheet()
  render()
  toast('Matched', `${l.desc} · ${money(l.dr || l.cr)} → ${l.doc[0]}`)
}
/* a line only the bank has: posted as its own BKK or BKM, then it is matched */
function rcBook(accId, lineId) {
  const l = stmtOf(accId).lines.find(x => x.id === lineId), x = l.src, t = MODE[x.m], no = t.next, amt = l.dr || l.cr, a = ACC[accId]
  VOUCHERS[x.m].unshift({ no, date: TODAY, time: nowHM(), party: null, acc: accId, method: 'transfer', ref: l.desc.slice(0, 24), amt, st: 'posted', what: x.note, other: [[x.gl, x.note, amt]] })
  t.next = `${t.code}/HO/2610/${String(+no.slice(-4) + 1).padStart(4, '0')}`
  if (x.m === 'bkk') { a.books -= amt; a.outM += amt } else { a.books += amt; a.inM += amt }
  REC.booked[lineId] = no
  window.PAL_DOCS.push({ doc: 1, t: no, g: t.code, go: () => openDoc(x.m, no) })
  syncMatch(accId)
  if (S.stack.length && S.stack[S.stack.length - 1].line === lineId) closeSheet()
  render()
  toast(`${no} posted`, `${money(amt)} · ${x.gl} ${GL[x.gl]}`)
}
/* the printout: the one place the equation shows */
function rcPrint(accId) {
  const r = recSums(accId), a = r.s.a
  const items = [...r.s.lines.filter(l => l.st !== 'ok'), ...r.s.outs]
  openSheet({
    size: 'wide', crumb: ['Bank reconciliation', a.name], title: `Rekonsiliasi Bank · ${day(a.stmt)}`, pill: `<span class="code">${a.code}</span>`,
    body: `${facts([['Account', `${a.name} · ${a.no}`], ['Statement', `${day(r.s.from)} – ${day(a.stmt)}`], ['Prepared by', FIN], ['Printed', day(TODAY)]])}
      ${sec('Reconciliation', ladder([
        [`Bank · ${day(a.stmt)}`, money(a.bankBal)],
        ['− Books', money(a.books)],
        ['− To match', money(r.toMatch)],
        [`<span style="padding-left:16px">At the bank only · ${plural(r.own.length, 'line')}</span>`, signed(r.ownNet)],
        [`<span style="padding-left:16px">BG given, not cleared · ${r.gir.length}</span>`, signed(r.giroNet)],
        [`<span style="padding-left:16px">Deposits not landed · ${r.dep.length}</span>`, signed(-r.depNet)],
      ], ['= Difference', r.diff ? `<span class="bad">${money(r.diff)}</span>` : 'Rp 0']))}
      ${sec('To match', table({
        cols: [{ l: 'Date', k: 'd', w: 80 }, { l: 'Description', k: 'w' }, { l: 'Debit', k: 'dr', num: 1, w: 150 }, { l: 'Credit', k: 'cr', num: 1, w: 150 }, { l: 'In the books', k: 'm', w: 200 }],
        rows: items.map(o => ({ c: { d: dayS(o.date), w: `<span class="one">${esc(o.desc)}</span>`, dr: o.dr ? money(o.dr) : '', cr: o.cr ? money(o.cr) : '', m: o.st === 'book' ? 'Bank only' : o.st === 'match' ? `Match ${esc(o.doc[0])}` : esc(o.doc[0]) } })),
        foot: { d: '', w: plural(items.length, 'line'), dr: money(sumOf(items, 'dr')), cr: money(sumOf(items, 'cr')) },
        empty: 'Nothing to match',
      }))}`,
    foot: btn('Print', "soon('Sent to the printer')"),
  })
}

/* a stale account filter must not trap the menu row: reconcile() always brings a fresh one */
{ const go0 = go; go = function (id, tab, doc) { if (id === 'bank-rec' && S.id !== 'bank-rec' && S.f['bank-rec'] && S.f['bank-rec'] === REC.lastF) S.f['bank-rec'] = {}; return go0(id, tab, doc) } }

/* data.js has Giro Mandiri's bank at Rp 409.856.400, below its books, although BG 771204
   (Rp 76.350.000) is booked and still out. The statement ends at the figure that reconciles, so
   Cash & Bank and this page show one number. Move it into data.js to keep it there. */
/* the Cash & Bank cards count what this statement shows */
recBanks().forEach(a => syncMatch(a.id))

Object.assign(window, { openShopCash, openGiro, scGo, scDepForm, scDepShop, scDepSave, grList, grGive, grClear, grMatch, grReplace, grWrite, grOpenForm, grOpenSave, rcOpen, rcLine, rcConfirm, rcBook, rcPrint })
})()
