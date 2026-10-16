// The ten "Sales by …" screens (More › Sales by Store / Division / Tag / Article / SKU / PO /
// Supplier / Campaign / Payment / Cashier Session): the replaying chart, the figures under it,
// the voided line, each held against GET /api/v1/reports/sales/breakdown.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { agree, BY, breakdown, breakdownProblems, compactOk, fmtCount, jakartaToday, locateDownload, num, readGrid, readRace, readXlsx, rp } from '../../support/sales.ts';

const WAIT = { timeout: 120_000 };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const window_ = () => ({ from: `${jakartaToday().slice(0, 4)}-01-01`, to: jakartaToday() });

/** Screen = API for one breakdown screen (table, voided line, "Top N of M"). */
async function matches(ctx: { screen: Json; browser: Json }, kind: (typeof BY)[number], opts: { perStore?: boolean; needle?: string; extra?: Record<string, string>; from?: string; to?: string } = {}) {
  const { screen, browser } = ctx;
  const w = { ...window_(), ...(opts.from ? { from: opts.from } : {}), ...(opts.to ? { to: opts.to } : {}) };
  const got = await agree({
    api: () => breakdown(kind.by, w.from, w.to, opts.extra ?? {}),
    read: async () => {
      const end = Date.now() + 90_000;
      let grid = await readGrid(browser);
      const shapeOk = (g: typeof grid) => g.body.length > 0 && g.heads.length === (opts.perStore ? 2 : 1);
      while (Date.now() < end && !shapeOk(grid)) {
        await new Promise((r) => setTimeout(r, 1000));
        grid = await readGrid(browser);
      }
      const lines = (await browser.evaluate((_: string) => (Array.from(document.querySelectorAll('p')) as HTMLElement[]).map((p) => p.innerText.replace(/\s+/g, ' ').trim()).filter((t) => /^(Voided sales|Top )/.test(t)), '')) as string[];
      return { grid, lines };
    },
    stable: (api) => [api.total, api.rows, api.voided, api.cells, api.rows_total],
    check: (s, api) => {
      const bad = breakdownProblems(kind, s.grid, api, opts.perStore === true, opts.needle ?? '');
      const voided = `Voided sales: ${fmtCount(api.voided.count)} · ${rp(api.voided.gross_minor)}`;
      if (!s.lines.includes(voided)) bad.push(`voided line ${JSON.stringify(s.lines)} lacks "${voided}"`);
      const top = `Top ${fmtCount(api.rows.length)} of ${fmtCount(api.rows_total)} by net sales.`;
      if (api.rows_total > api.rows.length ? !s.lines.includes(top) : s.lines.some((l) => l.startsWith('Top '))) bad.push(`Top-N line ${JSON.stringify(s.lines)} vs "${top}"`);
      return bad;
    },
    reload: async () => {
      await browser.reload();
      await screen.getByRole('table').waitFor({ state: 'visible', timeout: 120_000 });
      // The Per store switch is the screen's own state, not the address bar's: a reload forgets it.
      if (opts.perStore) await screen.getByRole('button', 'Per store').tap();
    },
  });
  expect(got.problems, `${kind.path} ${JSON.stringify(w)}`).toEqual([]);
  return got.api as Json;
}

describe('Sales by … screens', { tags: ['sales'] }, () => {
  for (const kind of BY) {
    test(`SAL-27 ${kind.title}: table, Total and voided line equal the API`, { session: 'rina', tags: ['sales', ...(kind.by === 'tag' ? ['smoke'] : [])], timeout: 400_000 }, async ({ app, screen, browser }) => {
      await app.open(kind.path);
      await expect(screen.getByRole('heading', kind.title, { level: 1 })).toBeVisible(WAIT);
      await expect(screen.getByRole('table')).toBeVisible(WAIT);
      await matches({ screen, browser }, kind);
    });

    test(`SAL-28 ${kind.title}: the chart's bars are the biggest rows, in their own colour, with the window and total`, { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
      await app.open(kind.path);
      await expect(screen.getByRole('table')).toBeVisible(WAIT);
      const w = window_();
      const got = await agree({
        api: () => breakdown(kind.by, w.from, w.to),
        read: () => readRace(browser),
        stable: (api) => [api.total, api.rows],
        check: (race, api) => {
          const bad: string[] = [];
          const live = (api.rows as Json[]).filter((r) => r.net_minor > 0);
          const top = live.slice(0, 10);
          const names = top.map((r) => (r.code === '' ? kind.none : r.name));
          if (JSON.stringify([...race.bars.map((b) => b.name)].sort()) !== JSON.stringify([...names].sort())) bad.push(`bars ${JSON.stringify(race.bars.map((b) => b.name))} ≠ top ${JSON.stringify(names)}`);
          top.forEach((r) => {
            const bar = race.bars.find((b) => b.name === (r.code === '' ? kind.none : r.name));
            if (bar && !compactOk(bar.value, r.net_minor)) bad.push(`${r.name}: bar "${bar.value}" ≠ ${r.net_minor}`);
          });
          if (!race.total || !compactOk(race.total.replace(/^Total /, ''), api.total.net_minor)) bad.push(`total "${race.total}" ≠ ${api.total.net_minor}`);
          const extra = live.length - 10;
          if (extra > 0 ? race.more !== `+${extra} more in the table` : race.more !== null) bad.push(`more-line "${race.more}" vs +${extra}`);
          return bad;
        },
        reload: async () => {
          await browser.reload();
          await screen.getByRole('table').waitFor({ state: 'visible', timeout: 120_000 });
        },
      });
      expect(got.problems).toEqual([]);
    });
  }
});

describe('Sales by … · reading it differently', { tags: ['sales'] }, () => {
  for (const kind of BY.filter((k) => !k.oneShop)) {
    test(`SAL-29 ${kind.title}: Per store puts every store's Stock · Qty · Sales beside the rows`, { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
      await app.open(kind.path);
      await expect(screen.getByRole('table')).toBeVisible(WAIT);
      await screen.getByRole('button', 'Per store').tap();
      await expect(screen.getByRole('button', 'Per store')).toHaveAttribute('aria-pressed', 'true');
      await matches({ screen, browser }, kind, { perStore: true });
      await screen.getByRole('button', 'All').tap();
      await matches({ screen, browser }, kind);
    });
  }

  for (const kind of BY.filter((k) => k.oneShop)) {
    test(`SAL-29b ${kind.title}: rows are one shop already, so there is no Per store switch`, { session: 'rina', timeout: 400_000 }, async ({ app, screen }) => {
      await app.open(kind.path);
      await expect(screen.getByRole('table')).toBeVisible(WAIT);
      await expect(screen.getByRole('button', 'Per store')).toBeHidden();
    });
  }

  test('SAL-30 search narrows the rows by name or code in the browser, and says "No match."', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    const kind = BY.find((k) => k.by === 'tag')!;
    await app.open(kind.path);
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    const w = window_();
    const first = ((await breakdown('tag', w.from, w.to)).rows as Json[])[0];
    await screen.getByRole('textbox', kind.search).fill(first.name);
    await matches({ screen, browser }, kind, { needle: first.name });
    await screen.getByRole('textbox', kind.search).fill('zzzz-nothing');
    await expect(screen.getByText('No match.')).toBeVisible();
    await screen.getByRole('textbox', kind.search).fill('');
    await matches({ screen, browser }, kind);
  });

  test('SAL-31 Division filter narrows to one division; the division report itself has no such filter', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    const kind = BY.find((k) => k.by === 'tag')!;
    await app.open(kind.path);
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    await screen.getByRole('combobox', 'Division').tap();
    await screen.getByRole('option', 'Pria').tap();
    await matches({ screen, browser }, kind, { extra: { division: 'PRIA' } });
    await app.open('/sales/by-division');
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    await expect(screen.getByRole('combobox', 'Division')).toBeHidden();
  });

  test('SAL-32 Unit filter: the store with sales shows them, a store without shows "No sales in this window."', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    const kind = BY.find((k) => k.by === 'tag')!;
    await app.open(kind.path);
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    await screen.getByRole('combobox', 'Unit').tap();
    await screen.getByRole('option', 'C001 · Cikupa').tap();
    await matches({ screen, browser }, kind, { extra: { unit: 'store-01' } });
    await screen.getByRole('combobox', 'Unit').tap();
    await screen.getByRole('option', 'C002 · Muaro Bungo').tap();
    await expect(screen.getByText('No sales in this window.')).toBeVisible(WAIT);
    await expect(screen.getByRole('button', 'Export')).toBeDisabled();
    expect(((await breakdown('tag', window_().from, window_().to, { unit: 'store-02' })).rows as Json[]).length).toBe(0);
  });

  test('SAL-33 From / To: a window typed in is asked of the server; a start after the end asks for dates', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    const kind = BY.find((k) => k.by === 'tag')!;
    await app.open(kind.path);
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    const today = jakartaToday();
    await screen.getByRole('button', 'From').tap();
    await screen.getByRole('textbox', 'Type From').fill(today);
    await screen.getByRole('textbox', 'Type From').press('Enter');
    await expect(screen.getByRole('button', 'From')).toContainText(today.slice(8, 10));
    await matches({ screen, browser }, kind, { from: today });
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    await screen.getByRole('button', 'From').tap();
    await screen.getByRole('textbox', 'Type From').fill(tomorrow);
    await screen.getByRole('textbox', 'Type From').press('Enter');
    await expect(screen.getByText('Pick a start and an end date.')).toBeVisible(WAIT);
  });

  test('SAL-34 the scrubber stands on a step and the bars follow; Replay runs the window and ends on the last step', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    const kind = BY.find((k) => k.by === 'tag')!;
    await app.open(kind.path);
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    const slider = screen.getByRole('slider', 'Step of the window');
    await expect(slider).toBeEnabled(WAIT);
    const last = await slider.getAttribute('max');
    await expect(slider).toHaveValue(String(last));
    const end = await readRace(browser as Json);
    expect(end.bars.length).toBeGreaterThan(0);
    // One step back (September has no sales): no bars, total nothing.
    await slider.press('ArrowLeft');
    await expect(slider).toHaveValue(String(Number(last) - 1));
    const before = await readRace(browser as Json);
    expect(before.label).not.toBe(end.label);
    expect(before.bars).toEqual([]);
    expect(before.total).toMatch(/^Total Rp\s0$/);
    await slider.press('End');
    await expect(slider).toHaveValue(String(last));
    expect((await readRace(browser as Json)).bars.map((b) => b.name).sort()).toEqual(end.bars.map((b) => b.name).sort());
    // Replay starts over at the first step and walks to the last.
    await screen.getByRole('button', 'Replay from the start').tap();
    await expect(slider).toHaveValue('0');
    await expect(slider).toHaveValue(String(last), { timeout: 30_000 });
  });

  for (const by of ['tag', 'campaign', 'store'] as const) {
    test(`SAL-35 Export on Sales by ${by}: the sheet holds every row, the voided line and the Total`, { session: 'rina', timeout: 600_000 }, async ({ app, screen, browser }) => {
      const kind = BY.find((k) => k.by === by)!;
      await app.open(kind.path);
      await expect(screen.getByRole('table')).toBeVisible(WAIT);
      const w = window_();
      const api = await breakdown(by, w.from, w.to);
      await expect(screen.getByRole('button', 'Export')).toBeEnabled();
      const file = await (browser as Json).waitForDownload(() => screen.getByRole('button', 'Export').tap());
      expect(file.suggestedFilename).toMatch(new RegExp(`^Sales-by-${kind.noun}-All-Units-${w.from}-${w.to}\\.xlsx$`));
      const out = readXlsx(locateDownload(file.path, file.suggestedFilename));
      expect(out.sheet).toBe(`Sales by ${kind.noun}`);
      const withCode = by !== 'store';
      const head = [...(withCode ? ['Code'] : []), kind.noun, 'Articles', 'Quantity', 'Gross Sales', 'Discount', 'Returns', 'Net Sales', 'HPP', 'Gross Profit', 'Margin %', ...(api.has_stock ? ['Stock'] : [])];
      const at = out.rows.findIndex((r) => r[0] === head[0] && r[1] === head[1]);
      expect(at, JSON.stringify(out.rows.slice(0, 5))).toBeGreaterThanOrEqual(0);
      expect(out.rows[at].filter((c) => c !== null)).toEqual(head);
      const lead = withCode ? 2 : 1;
      (api.rows as Json[]).forEach((row, i) => {
        const line = out.rows[at + 1 + i];
        expect(line[lead - 1]).toBe(row.code === '' ? kind.none : row.name);
        expect(line[lead + 1], `${row.name} quantity`).toBe(row.quantity);
        expect(line[lead + 2], `${row.name} gross`).toBe(row.gross_minor);
        expect(line[lead + 3], `${row.name} discount`).toBe(row.discount_minor);
        expect(line[lead + 5], `${row.name} net`).toBe(row.net_minor);
        expect(line[lead + 6], `${row.name} cost`).toBe(row.cost_minor);
        expect(line[lead + 7], `${row.name} profit`).toBe(row.net_minor - row.cost_minor);
        if (api.has_stock) expect(line[lead + 9], `${row.name} stock`).toBe(row.stock);
      });
      const voided = out.rows.find((r) => r.includes('Voided sales'));
      expect(voided, 'voided line').toBeDefined();
      const last = out.rows[out.rows.length - 1];
      expect(last.includes('Total')).toBe(true);
      expect(last[lead + 5]).toBe(api.total.net_minor);
    });
  }
});
