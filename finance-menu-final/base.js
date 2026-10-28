/* ═════════ format ═════════ */
const TODAY = '2026-10-28'
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = iso => { const [y, m, d] = iso.split('-'); return `${+d} ${MON[+m - 1]} ${y}` }
const dayS = iso => { const [, m, d] = iso.split('-'); return `${+d} ${MON[+m - 1]}` }
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5)
const weekday = iso => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(iso + 'T00:00:00Z').getUTCDay()]
const dots = n => Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const money = n => (n < 0 ? '−' : '') + 'Rp ' + dots(n)
const num = n => (n < 0 ? '−' : '') + dots(n)
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + 'Rp ' + dots(n)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const plural = (n, w, ws) => `${n} ${n === 1 ? w : ws || w + 's'}`
const $ = (s, el = document) => el.querySelector(s)
const DASH = '<span class="faint">—</span>'
const ico = (n, size = '') => `<span class="ds-ico ds-ico-${n} ${size}"></span>`
const btn = (label, on, kind = 'primary', extra = '') => `<button class="ds-btn ds-btn--${kind} ${extra}" type="button" onclick="event.stopPropagation();${on}">${label}</button>`
const lnk = (label, on, icon = '') => `<button class="lnk" type="button" onclick="event.stopPropagation();${on}">${icon ? ico(icon) : ''}${label}</button>`
const pill = (t, tone = '') => `<span class="pill ${tone}">${t}</span>`
const st = (t, tone = '') => `<span class="st ${tone}">${t}</span>`
const q = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/* Indonesian amount in words, as 7Soft prints under the total */
function terbilang(n) {
  n = Math.floor(Math.abs(n))
  if (n === 0) return 'Nol rupiah'
  const s = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas']
  const w = x => x < 12 ? s[x] : x < 20 ? w(x - 10) + ' belas' : x < 100 ? w(Math.floor(x / 10)) + ' puluh ' + w(x % 10)
    : x < 200 ? 'seratus ' + w(x - 100) : x < 1000 ? w(Math.floor(x / 100)) + ' ratus ' + w(x % 100)
      : x < 2000 ? 'seribu ' + w(x - 1000) : x < 1e6 ? w(Math.floor(x / 1000)) + ' ribu ' + w(x % 1000)
        : x < 1e9 ? w(Math.floor(x / 1e6)) + ' juta ' + w(x % 1e6) : x < 1e12 ? w(Math.floor(x / 1e9)) + ' miliar ' + w(x % 1e9) : w(Math.floor(x / 1e12)) + ' triliun ' + w(x % 1e12)
  const t = w(n).replace(/\s+/g, ' ').trim() + ' rupiah'
  return t[0].toUpperCase() + t.slice(1)
}

/* a seeded random, so the demo books are the same on every load */
let SEED = 20261028
const rnd = () => { SEED = (SEED * 1103515245 + 12345) % 2147483648; return SEED / 2147483648 }
const pick = a => a[Math.floor(rnd() * a.length)]
const round = (n, to = 500) => Math.round(n / to) * to

/* ═════════ registry: reg({ id, group, label, render, badge, s7 }) ═════════
   group: stores · cash · pay · acc · (rep and setup are rows on their own, no heading) */
const GROUPS = [['stores', 'Stores'], ['cash', 'Cash & Bank'], ['pay', 'Payables'], ['acc', 'Accounting'], ['rep', ''], ['setup', '']]
const SCREENS = []
const reg = s => SCREENS.push(s)
const S = { id: null, tab: {}, q: {}, f: {}, stack: [], doc: null, day: '2026-10-27', sel: {} }
const curScreen = () => SCREENS.find(s => s.id === S.id) || SCREENS[0]
const tabOf = (id, dflt) => S.tab[id] || dflt
function setTab(id, key) { S.tab[id] = key; render() }
const filt = (id, k, d = '') => (S.f[id] && S.f[id][k]) ?? d
function setFilt(id, k, v) { (S.f[id] = S.f[id] || {})[k] = v; render() }

/* ═════════ building blocks ═════════ */
/* kpis: [{ label, value, tone, on }] — a figure with `on` filters the list below it */
const kpisHTML = ks => ks?.length ? `<div class="ds-kpis kpis">${ks.map(k => `<${k.on ? 'button type="button"' : 'div'} class="ds-kpi" ${k.on ? `onclick="${k.on}"` : ''}><div class="ds-kpi-label">${k.label}</div><div class="ds-kpi-value ${k.tone ? 'is-' + k.tone : ''}">${k.value}</div></${k.on ? 'button' : 'div'}>`).join('')}</div>` : ''
/* table({ cols:[{l, k, num, w, cls}], rows:[{c:{k:html}, on, cls, group}], foot:{k:html}, empty, min }) */
function table(m) {
  if (!m.rows.length) return `<div class="ds-table-card"><div class="empty-note">${m.empty || 'Nothing here'}</div></div>`
  const cls = c => [c.num ? 'is-num' : '', c.cls || ''].join(' ')
  return `<div class="ds-table-card ${m.min ? 'table-scroll' : ''}"><table class="ds-table tbl ${m.tbl || ''}" ${m.min ? `style="min-width:${m.min}px"` : ''}>
    <colgroup>${m.cols.map(c => `<col${c.w ? ` style="width:${c.w}px"` : ''}>`).join('')}</colgroup>
    <thead><tr>${m.cols.map(c => `<th class="${cls(c)}">${c.l}</th>`).join('')}</tr></thead>
    <tbody>${m.rows.map(r => r.group ? `<tr class="grp"><td colspan="${m.cols.length}">${r.group}</td></tr>` : `<tr class="${r.on ? 'ds-opens' : ''} ${r.cls || ''}" ${r.on ? `onclick="${r.on}"` : ''}>${m.cols.map(c => `<td class="${cls(c)}">${r.c[c.k] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>
    ${m.foot ? `<tfoot><tr>${m.cols.map(c => `<td class="${cls(c)}">${m.foot[c.k] ?? ''}</td>`).join('')}</tr></tfoot>` : ''}
  </table></div>`
}
/* chips: [[value, label, count?, icon?]] — icon radios, one picked */
const chips = (id, key, opts, dflt) => `<div class="chips" role="radiogroup">${opts.map(([v, l, n, i]) => `<button class="chip" type="button" role="radio" aria-checked="${filt(id, key, dflt) === v}" onclick="setFilt('${id}','${key}','${v}')">${i ? ico(i) : ''}${l}${n != null ? ` <span class="n">${n}</span>` : ''}</button>`).join('')}</div>`
const seg = (id, key, opts, dflt) => `<div class="seg" role="radiogroup">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${filt(id, key, dflt) === v}" onclick="setFilt('${id}','${key}','${v}')">${l}</button>`).join('')}</div>`
const search = (id, ph) => `<label class="ds-search">${ico('search')}<input type="search" placeholder="${ph}" value="${esc(S.q[id] || '')}" oninput="S.q['${id}']=this.value;renderKeep()"></label>`
const hit = (qq, ...xs) => !qq || xs.some(x => String(x ?? '').toLowerCase().includes(qq.toLowerCase()))
const bar = (...parts) => `<div class="ds-bar">${parts.filter(Boolean).join('')}</div>`
const spacer = '<span class="bar-spacer"></span>'
const selectBox = (opts, cur, on) => `<label class="sel"><select onchange="${on}">${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>` }).join('')}</select>${ico('chevron-down')}</label>`
/* the one day picker of Stores: ‹ Tue 27 Oct 2026 › */
const dayPick = () => `<span class="daypick"><button type="button" aria-label="Day before" onclick="S.day=addDays(S.day,-1);render()">${ico('chevron-left')}</button><span>${weekday(S.day)} ${day(S.day)}</span><button type="button" aria-label="Day after" onclick="if(S.day<addDays(TODAY,-1)){S.day=addDays(S.day,1);render()}">${ico('chevron-right')}</button></span>`
const field = (label, inner, o = {}) => `<label class="f7 ${o.cls || ''}"><span>${label}${o.req ? '<i class="req">*</i>' : ''}${o.optl ? `<i class="optl">${o.optl}</i>` : ''}</span>${inner}</label>`
const sec = (title, inner, right = '') => `<section class="sec"><div class="sec-head"><h3>${title}</h3>${right}</div>${inner}</section>`
const facts = xs => `<dl class="facts4">${xs.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('')}</dl>`
const tabsHTML = (id, tabs, cur) => `<div class="ds-tabs door-tabs" role="tablist">${tabs.map(([k, l, n]) => `<button class="ds-tab ${k === cur ? 'is-selected' : ''}" role="tab" aria-selected="${k === cur}" type="button" onclick="setTab('${id}','${k}')">${l}${n != null ? `<span class="tab-n">${n}</span>` : ''}</button>`).join('')}</div>`
/* page({ title, crumb:[label, onclick], pill, actions:[{label,on,icon,kind}], tabs, tab, kpis, body }) */
function page(p) {
  const id = curScreen().id
  const crumb = p.crumb ? `<button class="crumb-back" type="button" onclick="${p.crumb[1]}">${ico('chevron-left')}${p.crumb[0]}</button><span class="crumb-sep">/</span>` : ''
  return `<div class="door-head ${p.tabs ? '' : 'notabs'}"><div class="door-top"><div class="door-title">${crumb}<h1 class="ds-title">${p.title}</h1>${p.pill || ''}</div><div class="door-actions">${(p.actions || []).map(a => a.raw || `<button class="ds-btn ds-btn--${a.kind || 'primary'}" type="button" onclick="${a.on}">${a.icon ? ico(a.icon) : ''}${a.label}</button>`).join('')}</div></div>${p.tabs ? tabsHTML(id, p.tabs, p.tab) : ''}</div>${kpisHTML(p.kpis)}${p.body}`
}
function toast(title, desc, tone = 'ok') {
  const host = $('#toasts'), el = document.createElement('div')
  el.className = `ds-toast ds-toast--${tone} in`
  el.innerHTML = `${ico(tone === 'ok' ? 'check' : 'alert')}<div class="ds-toast-text"><div class="ds-toast-title">${title}</div>${desc ? `<div class="ds-toast-desc">${desc}</div>` : ''}</div>`
  const kill = () => { el.classList.add('gone'); setTimeout(() => el.remove(), 170) }
  host.appendChild(el); setTimeout(kill, 4200)
  while (host.children.length > 3) host.firstChild.remove()
}
const soon = what => toast(what, 'Prototype: nothing is saved')

/* ═════════ sheets: openSheet({ crumb, title, pill, body, foot, size }) ═════════
   Layer move: slides in from the right (340ms), what's under dims and never moves; closing
   takes the same path back (200ms). size: rail · wide · record · workspace */
function openSheet(o) {
  S.stack.push(o)
  drawLayers()
  const wraps = document.querySelectorAll('#layers .sheet-wrap')
  const top = wraps[wraps.length - 1]
  requestAnimationFrame(() => requestAnimationFrame(() => { top.classList.add('on'); $('#layers').classList.add('open') }))
}
function refreshSheet(o) { S.stack[S.stack.length - 1] = { ...S.stack[S.stack.length - 1], ...o }; drawLayers(true) }
function closeSheet() {
  const wraps = document.querySelectorAll('#layers .sheet-wrap'), top = wraps[wraps.length - 1]
  if (!top) return
  top.classList.remove('on'); top.classList.add('out')
  if (S.stack.length === 1) $('#layers').classList.add('closing')
  setTimeout(() => { S.stack.pop(); drawLayers(true) }, 200)
}
function drawLayers(settled) {
  const el = $('#layers')
  el.classList.remove('closing')
  if (!S.stack.length) { el.className = 'layers'; el.innerHTML = ''; return }
  el.innerHTML = `<div class="veil" onclick="closeSheet()"></div>` + S.stack.map((o, i) => {
    const last = i === S.stack.length - 1
    const on = settled || !last ? 'on' : ''
    return `<div class="sheet-wrap ${on} ${last ? '' : 'under'}"><div class="ds ds-sheet ds-sheet--${o.size || 'wide'}" role="dialog" aria-label="${esc(o.titleText || '')}">
    <div class="ds-sheet-head"><div class="ds-sheet-headtext">${o.crumb ? `<div class="ds-sheet-crumb">${o.crumb.map(esc).join('<span class="ds-sep"> / </span>')}</div>` : ''}<div class="ds-sheet-titlerow"><h2 class="ds-sheet-title">${o.title}</h2>${o.pill || ''}</div></div>
    <button class="ds-sheet-close" type="button" aria-label="Close" onclick="closeSheet()">${ico('x', 'ds-ico--17')}</button></div>
    <div class="ds-sheet-body">${o.body}</div>${o.foot ? `<div class="ds-sheet-foot">${o.foot}</div>` : ''}</div></div>`
  }).join('')
  if (settled) el.classList.add('open')
}

/* ═════════ shell ═════════ */
function rail() { return `<nav class="ds-rail"><span class="ds-rail-btn find" role="button" aria-label="Find" onclick="openPalette()">${ico('search')}</span><span class="ds-rail-btn is-current" aria-label="Finance">${ico('wallet')}</span></nav>` }
function panel() {
  const cur = curScreen().id
  return `<aside class="ds-panel"><div class="p-head"><div class="ds-panel-title">Finance</div></div><div class="p-body">${GROUPS.map(([g, label]) => {
    const xs = SCREENS.filter(s => s.group === g)
    if (!xs.length) return ''
    return `${label ? `<span class="nav-label">${label}</span>` : '<div class="nav-gap"></div>'}<div class="ds-nav">${xs.map(s => {
      const b = s.badge ? s.badge() : null
      return `<button class="nav-row-btn ${s.id === cur ? 'on' : ''}" type="button" onclick="go('${s.id}')"><span>${s.label}</span>${b ? `<span class="nb ${b[1] || ''}">${b[0]}</span>` : ''}</button>`
    }).join('')}</div>`
  }).join('')}</div><div class="p-foot">${ico('calendar')}October 2026 · open</div></aside>`
}
function render() {
  const sc = curScreen()
  const body = S.doc && sc.doc ? sc.doc(S.doc) : sc.render()
  $('#stage').innerHTML = `<div class="ds ds-shell shell">${rail()}${panel()}<main class="ds-page page"><div class="ds-page-content">${body}</div></main></div>`
  if (sc.after) sc.after()
  history.replaceState(null, '', '#' + sc.id + (S.doc ? '/' + encodeURIComponent(S.doc) : S.tab[sc.id] ? '/' + S.tab[sc.id] : ''))
}
/* typing in a search box must not lose the caret */
function renderKeep() {
  const a = document.activeElement, inSearch = a && a.closest('.ds-search'), pos = a && a.selectionStart
  render()
  if (inSearch) { const n = $('.ds-page .ds-search input'); if (n) { n.focus(); n.setSelectionRange(pos, pos) } }
}
function go(id, tab, doc) {
  S.id = id; S.doc = doc || null
  if (tab) S.tab[id] = tab
  while (S.stack.length) S.stack.pop()
  drawLayers(true)
  window.scrollTo(0, 0); render()
}
const openDoc = (id, doc) => go(id, null, doc)

/* ═════════ ⌘K: every row, every 7Soft name, every document number ═════════
   No animation — opened many times a day. */
const PAL = { open: false, q: '', i: 0 }
function palItems() {
  const xs = []
  SCREENS.forEach(s => {
    xs.push({ t: s.label, g: GROUPS.find(g => g[0] === s.group)[1] || s.label, go: () => go(s.id) })
    ;(s.s7 || []).forEach(([name, tab]) => xs.push({ t: name, seven: true, g: s.label, go: () => go(s.id, tab) }))
  })
  ;(window.PAL_DOCS || []).forEach(d => xs.push(d))
  const qq = PAL.q.trim().toLowerCase()
  return qq ? xs.filter(x => (x.t + ' ' + x.g).toLowerCase().includes(qq)).slice(0, 40) : xs.filter(x => !x.doc).slice(0, 60)
}
function openPalette() { PAL.open = true; PAL.q = ''; PAL.i = 0; drawPalette(); $('#palette input').focus() }
function closePalette() { PAL.open = false; drawPalette() }
function drawPalette(keepInput) {
  const el = $('#palette')
  if (!PAL.open) { el.className = 'palette'; el.innerHTML = ''; return }
  const items = palItems()
  PAL.i = Math.min(PAL.i, Math.max(0, items.length - 1))
  const list = items.length ? items.map((x, i) => `<button class="pal-row ${i === PAL.i ? 'on' : ''}" type="button" onmousemove="if(PAL.i!==${i}){PAL.i=${i};drawPalette(true)}" onclick="palGo(${i})"><span class="pr-t">${esc(x.t)}</span>${x.seven ? `<span class="pr-7">7Soft · lands on ${esc(x.g)}</span>` : `<span class="pr-g">${esc(x.g)}</span>`}</button>`).join('') : '<div class="empty-note">No menu or document by that name</div>'
  if (keepInput && $('#palette .pal-list')) { $('#palette .pal-list').innerHTML = list; return }
  el.className = 'palette open'
  el.innerHTML = `<div class="pv" onclick="closePalette()"></div><div class="pal" role="dialog" aria-label="Find"><div class="pal-in">${ico('search')}<input placeholder="Find a menu, a 7Soft name or a document number" value="${esc(PAL.q)}" oninput="PAL.q=this.value;PAL.i=0;drawPalette(true)"><kbd>esc</kbd></div><div class="pal-list">${list}</div></div>`
}
function palGo(i) { const x = palItems()[i]; closePalette(); if (x) x.go() }
addEventListener('keydown', ev => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); PAL.open ? closePalette() : openPalette(); return }
  if (PAL.open) {
    const n = palItems().length
    if (ev.key === 'Escape') { closePalette() }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); PAL.i = (PAL.i + 1) % Math.max(n, 1); drawPalette(true) }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); PAL.i = (PAL.i - 1 + n) % Math.max(n, 1); drawPalette(true) }
    else if (ev.key === 'Enter') { ev.preventDefault(); palGo(PAL.i) }
    return
  }
  if (ev.key === 'Escape' && S.stack.length) closeSheet()
})
function boot() {
  const raw = location.hash.slice(1), cut = raw.indexOf('/')
  const h = cut < 0 ? [decodeURIComponent(raw)] : [decodeURIComponent(raw.slice(0, cut)), decodeURIComponent(raw.slice(cut + 1))]
  const sc = SCREENS.find(s => s.id === h[0])
  if (sc) { S.id = h[0]; if (h[1]) { if (sc.doc && sc.isDoc && sc.isDoc(h[1])) S.doc = h[1]; else S.tab[h[0]] = h[1] } }
  render()
}
