// Screenshots of the real hub's PO detail / Review Count for every branch.
const { chromium } = require('/Users/hari/Documents/itulah/e2e/agentic/node_modules/playwright-core')
const fs = require('fs')
const path = require('path')

const BASE = process.env.HUB ?? 'http://localhost:5351'
const HIDE = ['count-mixed', 'rc-part-nao', 'rc-recount-short']
const CONFIRM = ['count-short']
const OUT = process.argv[2]
const ONLY = process.argv[3] ? process.argv[3].split(',') : null
const MOCK = fs.readFileSync(path.join(__dirname, 'mock.js'), 'utf8')
fs.mkdirSync(OUT, { recursive: true })

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(900)
}

/// Grow the viewport so a sheet's scrolling body fits whole, then shoot.
async function shootWhole(page, file, base) {
  const extra = await page.evaluate(() => {
    let most = 0
    for (const el of document.querySelectorAll('[role=dialog] *, .sheet-pop *')) {
      const s = getComputedStyle(el)
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2)
        most = Math.max(most, el.scrollHeight - el.clientHeight)
    }
    return most
  })
  if (extra > 0) {
    await page.setViewportSize({ width: base.width, height: base.height + extra + 8 })
    await page.waitForTimeout(500)
  }
  await page.evaluate(() => document.activeElement?.blur?.())
  await page.screenshot({ path: file })
  await page.setViewportSize(base)
}

;(async () => {
  const browser = await chromium.launch()
  const manifest = []
  for (const dev of [
    { id: 'desk', viewport: { width: 1440, height: 900 }, scale: 2 },
    { id: 'phone', viewport: { width: 414, height: 896 }, scale: 2, mobile: true },
  ]) {
    if (process.env.DEVS && !process.env.DEVS.split(',').includes(dev.id)) continue
    const ctx = await browser.newContext({
      viewport: dev.viewport, deviceScaleFactor: dev.scale, isMobile: !!dev.mobile, hasTouch: !!dev.mobile,
      timezoneId: 'Asia/Jakarta', reducedMotion: 'reduce',
    })
    const login = await ctx.request.post(`${BASE}/api/v1/auth/login`, { data: { username: 'admin', password: 'Password01' } })
    if (!login.ok()) throw new Error('login ' + login.status())
    await ctx.addInitScript(MOCK)
    const page = await ctx.newPage()
    await page.goto(`${BASE}/procurement/orders`, { timeout: 180000 })
    await settle(page)
    const branches = await page.evaluate(() => window.__PO_BRANCHES.map(b => ({ id: b.id, g: b.g, n: b.n, oid: b.oid, po: b.po, count: !!b.count, part: (b.lines || []).some(l => l && l.r) })))
    for (const b of branches) {
      if (ONLY && !ONLY.includes(b.id)) continue
      await page.goto(`${BASE}/procurement/orders?order=${b.oid}`)
      await settle(page)
      if (b.count) await page.getByRole('button', { name: 'Review Count' }).last().waitFor({ timeout: 15000 }).catch(() => {})
      if (b.id === 'recalled') await page.getByText('Recalled by the warehouse').waitFor({ timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(300)
      const f = `${dev.id}-${b.id}.png`
      await shootWhole(page, path.join(OUT, f), dev.viewport)
      manifest.push({ dev: dev.id, id: b.id, view: 'detail', file: f })
      if (b.count) {
        const btn = page.getByRole('button', { name: 'Review Count' }).last()
        if (await btn.isVisible().catch(() => false)) {
          await btn.click()
          await settle(page)
          const r = `${dev.id}-${b.id}-review.png`
          await shootWhole(page, path.join(OUT, r), dev.viewport)
          manifest.push({ dev: dev.id, id: b.id, view: 'review', file: r })
          if (HIDE.includes(b.id)) {
            const sw = page.getByRole('switch', { name: 'Hide Matched Items' })
            if (await sw.isVisible().catch(() => false)) {
              await sw.click()
              await page.waitForTimeout(600)
              const h = `${dev.id}-${b.id}-hide.png`
              await shootWhole(page, path.join(OUT, h), dev.viewport)
              manifest.push({ dev: dev.id, id: b.id, view: 'hide', file: h })
            } else console.log('no Hide matched on', b.id, dev.id)
          }
          if (CONFIRM.includes(b.id)) {
            await page.getByRole('button', { name: 'Close Short' }).last().click()
            await page.waitForTimeout(800)
            const c = `${dev.id}-${b.id}-confirm.png`
            await page.screenshot({ path: path.join(OUT, c) })
            manifest.push({ dev: dev.id, id: b.id, view: 'confirm', file: c })
            await page.keyboard.press('Escape')
            await page.waitForTimeout(500)
          }
          if (b.part) {
            const last = page.getByRole('button', { name: 'Last Receiving' })
            if (await last.isVisible().catch(() => false)) {
              await last.click()
              await settle(page)
              const l = `${dev.id}-${b.id}-last.png`
              await page.screenshot({ path: path.join(OUT, l) })
              manifest.push({ dev: dev.id, id: b.id, view: 'last', file: l })
            }
          }
        } else console.log('no Review Count button on', b.id, dev.id)
      }
      console.log(dev.id, b.id)
    }
    await ctx.close()
  }
  const mf = path.join(OUT, 'manifest.json')
  const old = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : []
  const keep = old.filter(o => !manifest.some(n => n.file === o.file))
  fs.writeFileSync(mf, JSON.stringify([...keep, ...manifest], null, 1))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
