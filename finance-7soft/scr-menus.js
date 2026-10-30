/* every menu of the 7Soft manual, marked: same as 7Soft · differs · not built · outside finance */
;(() => {
  const state = id => {
    const c = (typeof COVER !== 'undefined' && COVER[id]) || null
    if (!c) return ['none', 'No screen']
    if (c.proto[0] === 'yes') return ['same', 'Same as 7Soft']
    if (c.proto[0] === 'part') return ['differs', 'Differs · ' + c.proto[1]]
    return ['differs', c.proto[1]]
  }
  const CH = { same: ['ok', 'Same as 7Soft'], differs: ['warn', 'Differs'], none: ['bad', 'Not built'], out: ['', 'Outside finance'] }
  const chip = (k, extra) => `<span class="pill7 ${CH[k][0]}">${CH[k][1]}</span>${extra ? ` <span class="mute">${esc(extra)}</span>` : ''}`
  reg({ id: 'menus7', group: 'top', label: '7Soft menus', plain: true, render: () => {
    const f = filt('menus7', 'k', 'all')
    const all = MENUS7.map(([no, name, pg, grp, sid, scope, note]) => {
      const built = sid && (SCREENS7[sid] || (SCREENS.find(s => s.id === sid) || {}).href)
      const st = sid ? state(sid) : null
      const k = !sid ? (scope === 'fin' ? 'none' : 'out') : st[0]
      return { no, name, pg, grp, sid, scope, note, built: !!built, k, detail: st ? st[1].replace(/^Differs · /, '') : '' }
    })
    const n = k => all.filter(r => r.k === k).length
    const fin = all.filter(r => r.scope === 'fin')
    const shown = all.filter(r => f === 'all' || r.k === f)
    const rows = []
    let last = ''
    shown.forEach(r => {
      if (r.grp !== last) { rows.push({ group: r.grp }); last = r.grp }
      rows.push({ on: r.sid ? `S.mode='ba';go('${r.sid}')` : '', c: {
        no: r.no, m: `<span class="nm">${esc(r.name)}</span>`, pg: 'hal. ' + r.pg,
        b: r.sid ? (r.built ? '<span class="pill7 ok">Built</span>' : '<span class="pill7 bad">Missing</span>') : '<span class="pill7">—</span>',
        a: chip(r.k, r.k === 'differs' ? r.detail : r.k === 'none' ? 'finance menu, no screen' : r.k === 'out' ? (r.note || 'stock · master data · system') : ''),
        s: r.sid ? esc(((SCREENS.find(s => s.id === r.sid) || {}).label) || r.sid) : DASH,
      } })
    })
    return page({ title: '7Soft menus', kpis: [
      { label: '7Soft menus in the manual', value: all.length }, { label: 'Finance menus', value: fin.length },
      { label: 'Same as 7Soft', value: n('same') }, { label: 'Differs from 7Soft', value: n('differs') }, { label: 'Finance, not built', value: n('none'), bad: n('none') > 0 },
    ], body: `<div class="v7bar">${chips('menus7', 'k', [['all', 'All', all.length], ['same', 'Same as 7Soft', n('same')], ['differs', 'Differs', n('differs')], ['none', 'Not built (finance)', n('none')], ['out', 'Outside finance', n('out')]], 'all')}</div>` +
      table({ cols: [{ l: 'No', k: 'no', w: 70 }, { l: '7Soft menu', k: 'm', w: 260 }, { l: 'Manual', k: 'pg', w: 90 }, { l: '7Soft copy', k: 'b', w: 110 }, { l: 'Central screen', k: 's', w: 230 }, { l: 'Against 7Soft', k: 'a' }], rows }) })
  } })
})();
