/* one page: every 7Soft menu, and where it stands in the prototype, the hub and the backend */
;(() => {
  const W = { yes: ['ok', 'Yes'], part: ['warn', 'Partly'], no: ['bad', 'No'], pending: ['', 'Checking'], central: ['', 'Central only'], ref: ['', 'Reference'] }
  const p = st => { const w = W[st] || ['', st]; return `<span class="pill7 ${w[0]}">${w[1]}</span>` }
  reg({ id: 'coverage', group: 'top', label: 'Coverage', plain: true, render: () => {
    const is7 = s => ['cash', 'gl', 'buy', 'sell', 'master'].includes(s.group)
    const rows = SCREENS.filter(s => s.id !== 'coverage' && is7(s) && COVER[s.id]).map(s => {
      const c = COVER[s.id] || {}, h = HUB[s.id] || []
      return { on: `S.mode='ba';go('${s.id}')`, c: { m: `<span class="nm">${esc(s.label)}</span>`, g: esc((GROUPS.find(g => g[0] === s.group) || [, ''])[1]), p: c.proto ? p(c.proto[0]) + ` <span class="mute">${esc(c.proto[1])}</span>` : DASH, h: h[0] ? p(h[0]) : DASH, a: c.api ? p(c.api[0]) : DASH } }
    })
    const n = st => SCREENS.filter(s => is7(s) && (COVER[s.id] || {}).api && COVER[s.id].api[0] === st).length
    return page({ title: 'Coverage', sub: '25 menu 7Soft. Fitur central-only (Shop cash, Between units, ERP+) ada di group Di luar 7Soft.', kpis: [{ label: '7Soft menus', value: SCREENS.filter(is7).length }, { label: 'Backend has it', value: n('yes') }, { label: 'Backend partly', value: n('part') }, { label: 'Backend missing', value: n('no'), bad: true }],
      body: table({ cols: [{ l: 'Menu', k: 'm', w: 240 }, { l: 'Group', k: 'g', w: 150 }, { l: 'Prototype has all of 7Soft', k: 'p' }, { l: 'Hub', k: 'h', w: 120 }, { l: 'Backend', k: 'a', w: 120 }], rows }) })
  } })
})();
