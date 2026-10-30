/* the sidebar: a chip on every 7Soft menu that differs from 7Soft; the two pages of this check sit at the top */
;(() => {
  ;['menus7', 'coverage'].forEach((id, i) => { const s = SCREENS.find(x => x.id === id); if (s) { SCREENS.splice(SCREENS.indexOf(s), 1); SCREENS.splice(i, 0, s); s.group = 'top' } })
  SCREENS.forEach(s => { const c = COVER[s.id]; if (['cash', 'gl', 'buy', 'sell', 'master'].includes(s.group) && c) s.tag = c.proto[0] === 'yes' ? 'same' : '≠' })
})()
