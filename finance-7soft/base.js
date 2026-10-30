/* ═════════ format ═════════ */
const TODAY = '2026-10-27'
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const day = iso => { const [y, m, d] = iso.split('-'); return `${d} ${MON[+m - 1]} ${y}` }
const dayS = iso => { const [, m, d] = iso.split('-'); return `${+d} ${MON[+m - 1]}` }
const dots = n => Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const money = n => (n < 0 ? '−' : '') + 'Rp ' + dots(n)
const num = n => (n < 0 ? '−' : '') + dots(n)
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const plural = (n, w) => `${n} ${n === 1 ? w : w + 's'}`
const $ = (s, el = document) => el.querySelector(s)
const DASH = '<span class="ds-empty-value">—</span>'
const ico = (n, size = '') => `<span class="ds-ico ds-ico-${n} ${size}"></span>`
const btn = (label, on, kind = 'primary', extra = '') => `<button class="ds-btn ds-btn--${kind} ${extra}" type="button" onclick="event.stopPropagation();${on}">${label}</button>`
const pill = (t, tone = '') => `<span class="pill7 ${tone}">${t}</span>`

/* ═════════ the books ═════════
   Location = the last two digits of a 12-digit account: 00 head office, 01–13 shops C001–C013.
   The unit names beside the codes are placeholders — the client has not given the mapping. */
const LOCS = [['HO', 'Head office'], ['C001', 'Shop C001'], ['C002', 'Shop C002'], ['C003', 'Shop C003'], ['C004', 'Shop C004'], ['C005', 'Shop C005'], ['C006', 'Shop C006'], ['C007', 'Shop C007'], ['C008', 'Shop C008'], ['C009', 'Shop C009'], ['C010', 'Shop C010'], ['C011', 'Shop C011'], ['C012', 'Shop C012'], ['C013', 'Shop C013']]
const LOC_CODES = LOCS.map(l => l[0])
const acc12 = (base10, loc) => base10 + String(LOC_CODES.indexOf(loc)).padStart(2, '0')
const accName = c => COA_NAME[c] || COA_NAME[String(c).slice(0, 10)] || String(c)
const accLabel = (base10, loc) => `${acc12(base10, loc)} · ${accName(base10)} ${loc}`
/* the 14 counterparties of the affiliate accounts, as the chart names them */
const AFFIL = ['HEAD OFFICE', 'CIKUPA', 'MUARO BUNGO', 'PURBALINGGA', 'BUMIAYU', 'JAMBI', 'WIRAMODE', 'BREBES', 'PASURUAN', 'WMJB', 'WMBA', 'SIPIN', 'BANJARAN', 'WONOSOBO']
const PERIOD = { name: 'October 2026', from: '2026-10-01', to: '2026-10-31', open: true }
const PERIODS = [['Sep 2026', 'closed'], ['Oct 2026', 'open'], ['Nov 2026', 'not yet']]
/* cash and bank accounts that a BKM / BKK can pick (Tipe Account = Kas/Bank) */
const KAS = [
  { code: '1011001001', name: 'Cash on Hand', open: 18400000 },
  { code: '1011001002', name: 'Petty Cash', open: 3250000 },
  { code: '1011001003', name: 'Modal Kasir', open: 1500000 },
  { code: '1011002001', name: 'Cash In Bank Giro Bank BCA', open: 1284750400 },
  { code: '1011002002', name: 'Cash In Bank Giro Bank MANDIRI', open: 412300000 },
  { code: '1011003001', name: 'Cash In Bank Tabungan Bank BCA', open: 96500000 },
]
const SUPPLIERS = [
  { code: 'S-0102', name: 'Garmen Mitra Sentosa, PT', term: 'T30', limit: 500000000, hutang: 51014500 },
  { code: 'S-0045', name: 'Sumber Komputer', term: 'T14', limit: 100000000, hutang: 8374200 },
  { code: 'S-0131', name: 'CV Anugrah Textile', term: 'T30', limit: 250000000, hutang: 12450000 },
  { code: 'S-0208', name: 'PT Graha Clean', term: 'T7', limit: 50000000, hutang: 4200000 },
  { code: 'S-0077', name: 'Sepatu Sejahtera, CV', term: 'T30', limit: 200000000, hutang: 76350000 },
]
const CUSTOMERS = [
  { code: 'M89', name: 'Agung Jaya Sentosa', term: 'T30', limit: 500000000, piutang: 37763250 },
  { code: 'C17', name: 'Citra Terang Sinar Mulyo', term: 'T14', limit: 100000000, piutang: 442850 },
  { code: 'G03', name: 'Gunawan, Bpk Indah', term: 'T7', limit: 20000000, piutang: 34250 },
  { code: 'C-0212', name: 'Toko Maju Jaya', term: 'T30', limit: 150000000, piutang: 5825000 },
]
const TERMS = [['T7', '7 days'], ['T14', '14 days'], ['T30', '30 days'], ['T45', '45 days'], ['CASH', 'Cash']]

/* ═════════ registry: every screen is reg({ id, group, label, render }) ═════════ */
const GROUPS = [
  ['cash', 'Cash & bank'], ['gl', 'General ledger'], ['buy', 'Purchasing'], ['sell', 'Sales'], ['master', 'Master & settings'], ['report', 'Reports'],
]
const SCREENS = []
const reg = s => SCREENS.push(s)
/* a 7Soft version of a screen: the same content as the manual shows (fields, columns, tabs, buttons, words), registered under the same id.
   reg7({ id, title7, render }) — render() returns the page html, written with the same helpers. */
const SCREENS7 = {}
const reg7 = s => { SCREENS7[s.id] = s }
const S = { id: null, tab: {}, q: {}, f: {}, stack: [], v7: false, mode: 'central' }
/* what the real hub (frontend-hub) has today for each menu — read off screens/finance/nav.ts on 27 Oct 2026 */
const HUB = {
  'kas-info': ['part', 'Cash & Bank: accounts · reconciliation · statement lines · advances; Stores: cash on hand · cash counts · deposits'],
  'kas-report': ['part', 'Bank reconciliation summary · cash last counted · finance-final/cash — not all 20 reports'],
  'store-cash': ['yes', 'Stores: cash on hand · petty cash · cashier float · cash counts · deposits'],
  'bkm-bkk': ['yes', 'BKM · BKK (Klasik form) · repeating vouchers'],
  'giro-board': ['yes', 'Giro board'],
  'replica': ['ref', 'Reference only'],
  'gl-info': ['part', 'Chart of accounts · General ledger · Trial balance — separate screens'],
  'gl-journal': ['yes', 'Journal entries · Journal templates'],
  'gl-closing': ['part', 'Month end checklist · Periods · Period closing voucher · no Reprocess'],
  'report-acc': ['part', 'Profit and loss ×3 · Balance sheet ×2 · Cash flow · Changes in equity'],
  'buy-invoice': ['yes', 'Payables › Bills · Recurring bills'],
  'buy-return': ['yes', 'Payables › Credit notes · returns in Procurement'],
  'buy-info': ['part', 'Bills · due dates · suppliers · credit notes · loans; payment instructions & reconciliation screens exist but are unrouted'],
  'buy-reports': ['part', 'Aging · Payment calendar'],
  'sell-invoice': ['no', 'None — Central sells at the till'],
  'sell-return': ['no', 'None in Finance'],
  'sell-cash': ['yes', 'POS · Finance › Stores › Sales postings'],
  'sell-info': ['part', 'Hidden Accounts Receivable (/finance/receivables/aging, finance-final/receivable) · card settlement · between units · no customer ledger'],
  'sell-reports': ['part', 'Sales by division · card settlement · orphan sales register / tender report not routed'],
  'coa-master': ['yes', 'Chart of accounts'],
  'coa-opening': ['no', 'No opening-balance screen found'],
  'coa-links': ['yes', 'Account links · Posting readiness'],
  'setup-switches': ['part', 'Posting policies; number series / banking readiness / payment terms not routed'],
  'parties': ['part', 'Supplier ledger & AP summary · supplier master in Procurement/GA · tax setup · no customer master'],
  'assets': ['yes', 'Asset register · Asset classes · Disposals · Projects'],
  'interunit': ['part', 'Between-units rows live inside the hidden Accounts Receivable screen; no dedicated route'],
  'users': ['yes', 'Finance permissions · roles in People'],
  'history': ['part', 'Chart changes / account-link history only; no Finance history route'],
}
const HUBWORD = { yes: ['ok', 'In the hub'], part: ['warn', 'Partly in the hub'], no: ['bad', 'Not in the hub'], ref: ['', 'Reference'] }
const curScreen = () => SCREENS.find(s => s.id === S.id) || SCREENS[0]
const tabOf = (id, dflt) => S.tab[id] || dflt
function setTab(id, key) { S.tab[id] = key; render() }
const filt = (id, k, d = '') => (S.f[id] && S.f[id][k]) ?? d
function setFilt(id, k, v) { (S.f[id] = S.f[id] || {})[k] = v; if (k !== 'p') S.f[id].p = '0'; render() }

/* ═════════ building blocks ═════════ */
const kpisHTML = ks => ks?.length ? `<div class="ds-kpis kpis">${ks.map(k => `<div class="ds-kpi"><div class="ds-kpi-label">${k.label}</div><div class="ds-kpi-value ${k.bad ? 'is-bad' : ''}">${k.value}</div></div>`).join('')}</div>` : ''
/* table({ cols:[{l, k|f, num, w}], rows:[{c:{k:html}, on, cls, group}], foot:{k:html}, empty }) — row cells are html strings */
function table(m) {
  if (!m.rows.length) return `<div class="ds-table-card"><div class="ds-empty"><p>${m.empty || 'Nothing here'}</p></div></div>`
  const td = (c, r) => `<td class="${c.num ? 'is-num' : ''}">${r.c[c.k] ?? ''}</td>`
  return `<div class="ds-table-card"><table class="ds-table tbl t7 ${m.tbl || ''}">
    <colgroup>${m.cols.map(c => `<col${c.w ? ` style="width:${c.w}px"` : ''}>`).join('')}</colgroup>
    <thead><tr>${m.cols.map(c => `<th class="${c.num ? 'is-num' : ''}">${c.l}</th>`).join('')}</tr></thead>
    <tbody>${m.rows.map(r => r.group ? `<tr class="grp"><td colspan="${m.cols.length}"><div class="grp-in">${r.group}</div></td></tr>` : `<tr class="${r.on ? 'ds-opens' : ''} ${r.cls || ''}" ${r.on ? `onclick="${r.on}"` : ''}>${m.cols.map(c => td(c, r)).join('')}</tr>`).join('')}</tbody>
    ${m.foot ? `<tfoot><tr>${m.cols.map(c => `<td class="${c.num ? 'is-num' : ''}">${m.foot[c.k] ?? ''}</td>`).join('')}</tr></tfoot>` : ''}
  </table></div>`
}
/* chips: [[value,label,count?]] — an icon-radio filter row for screen id / key */
const chips = (id, key, opts, dflt) => `<div class="chips" role="radiogroup">${opts.map(([v, l, n]) => `<button class="chip" type="button" role="radio" aria-checked="${filt(id, key, dflt) === v}" onclick="setFilt('${id}','${key}','${v}')">${l}${n != null ? ` <span class="n">${n}</span>` : ''}</button>`).join('')}</div>`
const search = (id, ph) => `<label class="ds-search">${ico('search')}<input type="search" placeholder="${ph}" value="${esc(S.q[id] || '')}" oninput="S.q['${id}']=this.value;if(S.f['${id}'])S.f['${id}'].p='0';renderKeep()"></label>`
const hit = (q, ...xs) => !q || xs.some(x => String(x ?? '').toLowerCase().includes(q.toLowerCase()))
const bar = (...parts) => `<div class="ds-bar">${parts.join('')}<span class="bar-spacer"></span></div>`
const field = (label, inner, cls = '') => `<label class="field7 ${cls}"><span>${label}</span>${inner}</label>`
const input = (v = '', ro = false, ph = '') => `<input value="${esc(v)}" ${ro ? 'readonly' : ''} placeholder="${esc(ph)}">`
const select = (opts, cur) => `<select>${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>` }).join('')}</select>`
const section = (title, inner, right = '') => `<div class="ds-section" style="margin-bottom:24px"><div class="sec-head"><h3 class="ds-section-title">${title}</h3>${right}</div>${inner}</div>`
const tabsHTML = (id, tabs, cur) => `<div class="ds-tabs door-tabs" role="tablist">${tabs.map(([k, l, n]) => `<button class="ds-tab ${k === cur ? 'is-selected' : ''}" role="tab" aria-selected="${k === cur}" type="button" onclick="setTab('${id}','${k}')">${l}${n != null ? ` <span class="ds-count">${n}</span>` : ''}</button>`).join('')}</div>`
/* page({ title, sub, actions:[{label,on,icon}], tabs:[[k,label,count]], tab, kpis:[{label,value,bad}], body }) — actions are all solid primary buttons */
function page(p) {
  const id = curScreen().id
  return `<div class="door-head"><div class="door-top"><h1 class="ds-title">${p.title}</h1><div class="door-actions">${(p.actions || []).map(a => `<button class="ds-btn ds-btn--${a.kind || 'primary'}" type="button" onclick="${a.on}">${a.icon ? ico(a.icon) : ''}${a.label}</button>`).join('')}</div></div>${p.tabs ? tabsHTML(id, p.tabs, p.tab) : ''}</div>${p.sub ? `<p class="page-sub">${p.sub}</p>` : ''}${kpisHTML(p.kpis)}${p.body}`
}
function toast(title, desc) {
  const host = $('#toasts'), el = document.createElement('div')
  el.className = 'ds-toast ds-toast--ok in'
  el.innerHTML = `${ico('check')}<div class="ds-toast-text"><div class="ds-toast-title">${title}</div>${desc ? `<div class="ds-toast-desc">${desc}</div>` : ''}</div>`
  const kill = () => { el.classList.add('gone'); setTimeout(() => el.remove(), 170) }
  host.appendChild(el); setTimeout(kill, 4200)
  while (host.children.length > 3) host.firstChild.remove()
}
const soon = what => toast(what, 'Prototype: nothing is saved')

/* sheets: openSheet({ crumb:[..], title, pill, body, foot, size }) · closeSheet() */
function openSheet(o) { S.stack.push(o); renderLayers() }
function closeSheet() { S.stack.pop(); renderLayers() }
function renderLayers() {
  const el = $('#layers'), top = S.stack[S.stack.length - 1]
  el.className = 'layers' + (top ? ' open' : '')
  el.innerHTML = top ? `<div class="veil" onclick="closeSheet()"></div><div class="sheet-wrap on"><div class="ds ds-sheet ds-sheet--${top.size || 'wide'}" role="dialog">
    <div class="ds-sheet-head"><div class="ds-sheet-headtext">${top.crumb ? `<div class="ds-sheet-crumb">${top.crumb.map(esc).join('<span class="ds-sep">/</span>')}</div>` : ''}<div class="ds-sheet-titlerow"><h2 class="ds-sheet-title">${top.title}</h2>${top.pill || ''}</div></div>
    <button class="ds-sheet-close" type="button" aria-label="Close" onclick="closeSheet()">${ico('x', 'ds-ico--17')}</button></div>
    <div class="ds-sheet-body">${top.body}</div>${top.foot ? `<div class="ds-sheet-foot">${top.foot}</div>` : ''}</div></div>` : ''
}

/* ═════════ shell ═════════ */
function rail() { return `<nav class="ds-rail"><span class="ds-rail-btn find" aria-label="Search">${ico('search')}</span><span class="ds-rail-btn is-current" aria-label="Finance">${ico('wallet')}</span></nav>` }
function panel() {
  return `<aside class="ds-panel"><div class="p-head"><div class="ds-panel-title">Finance</div></div><div class="p-body">${GROUPS.map(([g, label]) => {
    const xs = SCREENS.filter(s => s.group === g)
    return xs.length ? `<span class="nav-label">${label}</span><div class="ds-nav">${xs.map(s => `<button class="nav-row-btn ${s.id === curScreen().id ? 'on' : ''}" type="button" onclick="go('${s.id}')"><span>${s.label}</span>${s.tag ? `<span class="tag7">${s.tag}</span>` : ''}</button>`).join('')}</div>` : ''
  }).join('')}</div><div class="p-foot">${ico('clock')}${day(TODAY)} · ${PERIOD.name}</div></aside>`
}
/* Central ⇄ 7Soft switch, at the head of every screen */
/* the After side is drawn at full width, then shrunk to fit its half of the page */
function fitBA() { document.querySelectorAll('.ba-col.a .ba-zoom').forEach(z => { const w = z.parentElement.clientWidth - 32; z.style.width = '1180px'; z.style.zoom = Math.min(1, w / 1180) }) }
addEventListener('resize', () => { if (S.mode === 'ba') fitBA() })
function setMode(m) { S.mode = m; S.v7 = m === '7soft'; render() }
function v7bar(sc, s7) {
  const b = (m, l) => `<button class="chip" type="button" role="radio" aria-checked="${S.mode === m}" onclick="setMode('${m}')">${l}</button>`
  const h = HUB[sc.id], hw = h ? HUBWORD[h[0]] : null
  return `<div class="v7bar"><div class="chips seg" role="radiogroup" aria-label="Version">${b('7soft', 'Before · 7Soft')}${b('ba', 'Before → After')}${b('central', 'After · Central')}</div>${h ? `<span class="pill7 ${hw[0]}">${hw[1]}</span><span class="v7note">${esc(h[1])}</span>` : ''}</div>`
}
/* before → after: 7Soft on the left, Central on the right, each drawn at a smaller scale.
   Dense screens (a log or a report) ask for stackBA: side by side would shrink the After table
   to an unreadable size, so they are compared top-to-bottom at full size instead. */
/* the real 7Soft screens, as the manual prints them */
const shots = id => (typeof MANUAL !== 'undefined' && MANUAL[id]) || []
const shotsHTML = id => shots(id).map(([f, pg]) => `<figure class="shot"><img src="7soft-ref/manual/${f}" alt="7Soft screen, manual page ${pg}" loading="lazy" style="cursor:zoom-in" onclick="openSheet({size:'workspace',crumb:['7Soft'],title:'Manual hal. ${pg}',body:'<img src=&quot;7soft-ref/manual/${f}&quot; style=&quot;width:100%;height:auto&quot;>'})"><figcaption>Manual hal. ${pg}</figcaption></figure>`).join('')
/* three answers per menu: does the prototype cover 7Soft, does the hub have it, does the backend have it */
const COVWORD = { yes: ['ok', 'Yes'], part: ['warn', 'Partly'], no: ['bad', 'No'], pending: ['', 'Checking'], central: ['', 'Central only'], ref: ['', 'Reference'] }
function coverHTML(id) {
  const c = (typeof COVER !== 'undefined' && COVER[id]) || null, h = HUB[id]
  if (!c && !h) return ''
  const card = (title, st, note, extra = '') => { const w = COVWORD[st] || ['', st]; return `<div class="cov-card"><div class="cov-t">${title}</div><span class="pill7 ${w[0]}">${w[1]}</span><div class="cov-n">${esc(note)}</div>${extra}</div>` }
  const miss = c && c.miss.length ? `<ul class="cov-miss">${c.miss.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''
  return `<div class="cov">${c ? card('Prototype has all of 7Soft?', c.proto[0], c.proto[1], miss) : ''}${h ? card('In the hub today?', h[0], h[1]) : ''}${c ? card('In the backend (cloud)?', c.api[0], c.api[1]) : ''}</div>`
}
function baView(sc) {
  const s7 = SCREENS7[sc.id], h = HUB[sc.id], hw = h ? HUBWORD[h[0]] : null
  let left, right
  const was = S.v7
  S.v7 = true
  left = shots(sc.id).length ? `<div class="shots">${shotsHTML(sc.id)}</div>` : `<div class="empty-note">${sc.href ? 'No screenshot' : '7Soft has no such menu'}</div>`
  S.v7 = false
  try { right = sc.href ? `<iframe title="${esc(sc.label)}" src="${sc.href}" style="width:100%;height:1100px;border:0"></iframe>` : sc.render() } catch (e) { right = `<div class="empty-note">Not built yet</div>` }
  S.v7 = was
  const col = (tag, title, sub, inner) => `<div class="ba-col ${tag.split(' ')[0]}"><div class="ba-head"><span class="ba-tag ${tag}">${title}</span><span class="v7note">${sub}</span></div><div class="ba-frame"><div class="ba-zoom">${inner}</div></div></div>`
  return coverHTML(sc.id) + `<div class="ba${sc.stackBA ? ' ba--stack' : ''}">${col('b shot-col', 'Before · 7Soft', sc.stackBA ? 'The manual screen, at full width' : shots(sc.id).length ? 'Screens from the manual' : '', left)}${col('a', 'After · Central', h ? `${hw[1]} today` : 'Prototype', right)}</div>`
}
function render() {
  const sc = curScreen()
  const s7 = S.v7 ? SCREENS7[sc.id] : null
  const hrefBody = `<div class="door-head"><div class="door-top"><h1 class="ds-title">${esc(sc.label)}</h1><div class="door-actions"><a class="ds-btn ds-btn--secondary" href="${sc.href}" target="_blank" rel="noopener">Open full screen</a></div></div></div><p class="page-sub">The existing 7Soft prototype, opened inside the shell so the Finance menu stays in place.</p><iframe title="${esc(sc.label)}" src="${sc.href}" style="width:100%;height:calc(100vh - 240px);min-height:720px;border:1px solid var(--hairline);border-radius:var(--r-card);background:#fff"></iframe>`
  const body = sc.plain ? sc.render() : sc.href && S.mode === 'central' ? hrefBody : S.mode === 'ba' ? baView(sc) : S.v7 ? (shots(sc.id).length ? `<div class="shots big">${shotsHTML(sc.id)}</div>` : '') + (s7 ? `<h2 class="ds-section-title" style="margin:32px 0 16px">Same content, clickable</h2>${s7.render()}` : `<div class="door-head"><div class="door-top"><h1 class="ds-title">${sc.label}</h1></div></div><div class="empty-note">${sc.href ? 'This screen has no 7Soft version yet — it opens the existing prototype.' : '7Soft has no such menu.'}</div>`) : sc.render()
  $('#stage').innerHTML = `<div class="ds ds-shell shell">${rail()}${panel()}<main class="ds-page page"><div class="ds-page-content">${sc.plain ? '' : v7bar(sc, s7)}${body}</div></main></div>`
  fitBA()
  $('#pcount').textContent = plural(SCREENS.length, 'screen')
  history.replaceState(null, '', '#' + sc.id + (S.tab[sc.id] ? '/' + S.tab[sc.id] : '') + '?v=' + S.mode)
}
/* typing in a search box must not lose the caret */
function renderKeep() {
  const a = document.activeElement, id = a && a.closest('.ds-search') ? 1 : 0, pos = a && a.selectionStart
  render()
  if (id) { const n = $('.ds-search input'); if (n) { n.focus(); n.setSelectionRange(pos, pos) } }
}
function go(id) { S.id = id; window.scrollTo(0, 0); render() }
addEventListener('keydown', ev => { if (ev.key === 'Escape' && S.stack.length) closeSheet() })
function boot() {
  const vm = location.hash.match(/v=(7soft|ba|central)/); if (vm) { S.mode = vm[1]; S.v7 = vm[1] === '7soft' }
  const h = location.hash.slice(1).split('?')[0].split('/')
  if (SCREENS.find(s => s.id === h[0])) { S.id = h[0]; if (h[1]) S.tab[h[0]] = h[1] }
  render()
}
