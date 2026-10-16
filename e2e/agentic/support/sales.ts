// Sales (hub › Sales) helpers: the endpoints the screens read, the same
// arithmetic the screens do, readers that lift the figures off the page, and
// `agree()` — the one way tests compare a screen with the API.
//
// The rig is shared: the POS agent keeps selling at store-01 while these tests
// run, so no figure here is ever hard-coded. A comparison reads the API before
// and after the screen and only trusts a pair of API reads that agree; a screen
// that disagrees with a stable API gets a reload and another go before it is
// called wrong.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { expect } from 'e2e';
import { as, rows as rowsOf } from './rig.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const cloud = () => as('cloud', 'rina');

// ── numbers and words ───────────────────────────────────────────────────────

/** "Rp 1.074.000" / "−Rp 5.000" / "6 pcs" / "1.234" → number; "—" → null. */
export function num(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const digits = text.replace(/[^\d]/g, '');
  if (digits === '') return null;
  return (/^\s*[−-]/.test(text) ? -1 : 1) * Number(digits);
}

/** "57,2%" → 57.2 (a dot followed by one or two digits is read as a decimal point: "100.0%") */
export function pct(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /([−-])?(\d[\d.]*(?:,\d+)?)\s*%/.exec(text);
  if (!m) return null;
  let body = m[2];
  body = /\.\d{1,2}$/.test(body) && !body.includes(',') ? body : body.replace(/\./g, '').replace(',', '.');
  return (m[1] ? -1 : 1) * Number(body.replace(',', '.'));
}

/** "Rp 2,3 M" / "145,1 K" / "Rp 700" → approximate rupiah. */
export function compact(text: string | null | undefined): { value: number; unit: number } | null {
  if (!text) return null;
  const m = /(\d+(?:[.]\d{3})*(?:,\d+)?)\s*([KMBT])?\s*$/.exec(text.replace(/Rp|\s/g, (s) => (s === 'Rp' ? '' : ' ')).trim());
  if (!m) return null;
  const unit = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2] as 'K'] ?? 1;
  const value = Number(m[1].replace(/\./g, '').replace(',', '.')) * unit;
  return { value, unit };
}

/** A compact figure ("Rp 2,3 M") says the exact one to within its own rounding. */
export function compactOk(text: string | null | undefined, exact: number): boolean {
  const c = compact(text);
  if (!c) return false;
  if (c.unit === 1) return Math.round(c.value) === Math.round(exact);
  return Math.abs(c.value - Math.abs(exact)) <= c.unit * 0.051 + 1;
}

const en = (s: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', o).format(at(s)).replace(/\bSept\b/, 'Sep'); // the kit trims Sept to Sep
export const dayText = (s: string) => en(s, { day: '2-digit', month: 'short', year: 'numeric' });
export const dayMonthText = (s: string) => en(s, { day: '2-digit', month: 'short' });
/** The kit's dateRange(): "01–30 Sep 2026", "01 Jan – 09 Oct 2026", "09 Oct 2026". */
export function periodLabel(from: string, to: string): string {
  if (from.slice(0, 4) !== to.slice(0, 4)) return `${dayText(from)} – ${dayText(to)}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return from === to ? dayText(to) : `${en(from, { day: '2-digit' })}–${dayText(to)}`;
  return `${dayMonthText(from)} – ${dayText(to)}`;
}

export const near = (a: number | null, b: number | null, tol = 0.051) => a !== null && b !== null && Math.abs(a - b) <= tol;

/** The period "This year" and friends mean, copied from explorer-model.ts. */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
export const shiftDay = (s: string, by: number) => {
  const d = at(s);
  d.setDate(d.getDate() + by);
  return iso(d);
};
export const jakartaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const firstOfMonth = (s: string) => `${s.slice(0, 8)}01`;
const lastOfMonth = (s: string) => iso(new Date(at(s).getFullYear(), at(s).getMonth() + 1, 0));

export function resolvePeriod(period: string, today: string, latest: string | null, earliest: string | null) {
  const custom = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(period);
  if (custom) return { from: custom[1], to: custom[2] };
  const year = today.slice(0, 4);
  const monthStale = latest !== null && latest < firstOfMonth(today);
  const yearStale = latest !== null && latest < `${year}-01-01`;
  switch (period) {
    case 'month':
      return monthStale && latest ? { from: firstOfMonth(latest), to: lastOfMonth(latest) } : { from: firstOfMonth(today), to: today };
    case 'last': {
      const before = shiftDay(firstOfMonth(monthStale && latest ? latest : today), -1);
      return { from: firstOfMonth(before), to: before };
    }
    case 'all': {
      const to = latest ?? today;
      const from = earliest ?? `${to.slice(0, 4)}-01-01`;
      const floor = shiftDay(to, -3 * 365);
      return { from: from < floor ? floor : from, to };
    }
    default:
      return yearStale && latest ? { from: `${latest.slice(0, 4)}-01-01`, to: `${latest.slice(0, 4)}-12-31` } : { from: `${year}-01-01`, to: today };
  }
}

// ── the Explorer's endpoint ─────────────────────────────────────────────────

export const GROUPS = [
  { value: 'division', label: 'Division', one: 'division', many: 'divisions' },
  { value: 'tag', label: 'Tag', one: 'tag', many: 'tags' },
  { value: 'article', label: 'Article', one: 'article', many: 'articles' },
  { value: 'sku', label: 'SKU', one: 'SKU', many: 'SKUs' },
  { value: 'store', label: 'Store', one: 'store', many: 'stores' },
  { value: 'supplier', label: 'Supplier', one: 'supplier', many: 'suppliers' },
  { value: 'month', label: 'Month', one: 'month', many: 'months' },
  { value: 'session', label: 'Cashier session', one: 'cashier session', many: 'cashier sessions' },
  { value: 'payment', label: 'Payment method', one: 'payment method', many: 'payment methods' },
] as const;
export type GroupKey = (typeof GROUPS)[number]['value'];
export const noStock = (g: string) => g === 'month' || g === 'session' || g === 'payment';

export interface ExplorerArgs {
  from: string;
  to: string;
  group: string;
  stores?: string[];
  divisions?: string[];
  tags?: string[];
  suppliers?: string[];
  colours?: string[];
  sizes?: string[];
  q?: string;
  matrix?: boolean;
  offset?: number;
  limit?: number;
}

/** The query string the screen builds (explorer-data.ts paramsOf). */
export function explorerPath(a: ExplorerArgs): string {
  const p = new URLSearchParams({ from: a.from, to: a.to });
  p.set('group', a.group);
  for (const [name, values] of [['stores', a.stores], ['divisions', a.divisions], ['tags', a.tags], ['suppliers', a.suppliers], ['colours', a.colours], ['sizes', a.sizes]] as const) {
    if (values && values.length) p.set(name, values.join(','));
  }
  if (a.q && a.q.trim() !== '') p.set('q', a.q.trim());
  if (a.matrix) p.set('matrix', 'true');
  p.set('stock', 'true');
  p.set('limit', String(a.limit ?? 100));
  if (a.offset) {
    p.set('offset', String(a.offset));
    p.set('totals', 'false');
  }
  return `/api/v1/reports/sales/explorer?${p}`;
}

export const explorer = (a: ExplorerArgs): Promise<Json> => cloud().get(explorerPath(a));
export const explorerOptions = (): Promise<Json> => cloud().get('/api/v1/reports/sales/explorer/options');

/** Margin as the screen reads it (profit over the sales of the pieces that had a cost). */
export function marginOf(f: Json): number | null {
  if (f.profit_minor === null || f.profit_minor === undefined) return null;
  const whole = f.sales_minor - (f.uncosted_minor ?? 0);
  const v = (f.profit_minor / whole) * 100;
  return whole === 0 || !Number.isFinite(v) ? null : v;
}
export const shareOf = (f: Json, total: Json) => (total.sales_minor === 0 ? null : (f.sales_minor / total.sales_minor) * 100);

// ── reading the page ────────────────────────────────────────────────────────

export interface Cell {
  text: string;
  lines: string[];
  titles: string[];
  title: string | null;
}
export interface Grid {
  heads: string[][];
  body: Cell[][];
  foot: Cell[][];
}
type Evaluator = { evaluate: (fn: (arg: string) => unknown, arg: string) => Promise<unknown> } & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The first table on the page: heads, body rows and foot, cell by cell. */
export async function readGrid(browser: Evaluator, scope = 'table'): Promise<Grid> {
  return (await browser.evaluate((sel: string) => {
    const table = document.querySelector(sel);
    const cell = (el: Element) => {
      const html = el as HTMLElement;
      return {
        text: html.innerText.replace(/\s+/g, ' ').trim(),
        lines: html.innerText.split('\n').map((s) => s.trim()).filter(Boolean),
        titles: Array.from(el.querySelectorAll('[title]')).map((t) => t.getAttribute('title') ?? ''),
        title: el.getAttribute('title'),
      };
    };
    const rowsOf = (section: string) => Array.from(table?.querySelectorAll(`${section} > tr`) ?? []).map((tr) => Array.from(tr.children).map(cell));
    return {
      heads: rowsOf('thead').map((r) => r.map((c) => c.text)),
      body: rowsOf('tbody'),
      foot: rowsOf('tfoot'),
    };
  }, scope)) as Grid;
}

/** Every <table> inside `root`, as rows of cell texts (head rows included). */
export async function readTables(browser: Evaluator, root = '[role="dialog"]'): Promise<string[][][]> {
  return (await browser.evaluate((sel: string) => {
    const host = document.querySelector(sel) ?? document.body;
    return Array.from(host.querySelectorAll('table')).map((t) =>
      Array.from(t.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((c) => (c as HTMLElement).innerText.replace(/\s+/g, ' ').trim())),
    );
  }, root)) as string[][][];
}

export interface Kpi {
  label: string;
  value: string;
  valueTitle: string | null;
  delta: string;
  deltaTitle: string | null;
}
/** The Kpi cards (label, figure with its exact title, the line under it). */
export async function readKpis(browser: Evaluator): Promise<Kpi[]> {
  return (await browser.evaluate((_: string) => {
    return Array.from(document.querySelectorAll('.kpi-card')).map((card) => {
      const kids = Array.from(card.children) as HTMLElement[];
      const value = kids[1];
      const delta = card.querySelector('[data-kpi-delta]') as HTMLElement | null;
      return {
        label: kids[0]?.innerText.trim() ?? '',
        value: value?.innerText.trim() ?? '',
        valueTitle: value?.querySelector('[title]')?.getAttribute('title') ?? null,
        delta: delta?.innerText.replace(/\s+/g, ' ').trim() ?? '',
        deltaTitle: delta?.querySelector('[title]')?.getAttribute('title') ?? null,
      };
    });
  }, '')) as Kpi[];
}

/** Term → value of every <dl> in the open dialog (or the page). */
export async function readFacts(browser: Evaluator, root = '[role="dialog"]'): Promise<Record<string, string>> {
  return (await browser.evaluate((sel: string) => {
    const host = document.querySelector(sel) ?? document.body;
    const out: Record<string, string> = {};
    host.querySelectorAll('dl > div').forEach((d) => {
      const dt = d.querySelector('dt') as HTMLElement | null;
      const dd = d.querySelector('dd') as HTMLElement | null;
      if (dt && dd) out[dt.innerText.trim()] = dd.innerText.replace(/\s+/g, ' ').trim();
    });
    return out;
  }, root)) as Record<string, string>;
}

/** Text of the open dialog, line by line. */
export async function dialogLines(browser: Evaluator, root = '[role="dialog"]'): Promise<string[]> {
  return (await browser.evaluate((sel: string) => {
    const host = document.querySelector(sel) as HTMLElement | null;
    return (host?.innerText ?? '').split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }, root)) as string[];
}

/** URLs the page has fetched whose path contains `needle` (from resource timing). */
export async function requested(browser: Evaluator, needle: string): Promise<URL[]> {
  const urls = (await browser.evaluate((n: string) => performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.includes(n)), needle)) as string[];
  return urls.map((u) => new URL(u));
}

// ── agreeing with the API ───────────────────────────────────────────────────

/**
 * Read the API, then the screen, then the API again. Only a pair of API reads
 * that agree can be held against the screen (sales land while this runs); a
 * disagreement gets `reload()` and another try before it is reported.
 */
export async function agree<A, S>(opts: {
  api: () => Promise<A>;
  read: () => Promise<S>;
  check: (screen: S, api: A) => string[];
  reload: () => Promise<void>;
  /** What of the API must stand still while the screen is read. */
  stable?: (api: A) => unknown;
  tries?: number;
}): Promise<{ screen: S; api: A; problems: string[] }> {
  const tries = opts.tries ?? 5;
  let last: { screen: S; api: A; problems: string[] } | undefined;
  for (let i = 0; i < tries; i++) {
    const before = await opts.api();
    const screen = await opts.read();
    const after = await opts.api();
    const key = opts.stable ?? ((x: A) => x);
    if (JSON.stringify(key(before)) !== JSON.stringify(key(after))) {
      await opts.reload();
      continue; // the data moved under us
    }
    const problems = opts.check(screen, before);
    last = { screen, api: before, problems };
    if (problems.length === 0) return last;
    if (i < tries - 1) await opts.reload();
  }
  if (!last) throw new Error('the sales figures kept moving: no two API reads agreed in ' + tries + ' tries');
  return last;
}

// ── explorer rows, cell by cell ─────────────────────────────────────────────

/** The row's name cell: the exact label is the title of the first span. */
export const nameOf = (c: Cell) => c.titles[0] ?? c.lines[0] ?? '';

const dashCell = (c: Cell | undefined) => c !== undefined && /^[–—-]$/.test(c.text);

/** Totals table (non-payment): Sales · Discount · Gross profit · Stock · Acq · Share. */
export function totalsRowProblems(group: string, cells: Cell[], f: Json, total: Json, canCost: boolean, tag: string): string[] {
  const bad: string[] = [];
  const stock = !noStock(group);
  let i = 1;
  const salesCell = cells[i++];
  if (num(salesCell?.titles[0]) !== f.sales_minor) bad.push(`${tag}: Sales ${salesCell?.titles[0]} ≠ ${f.sales_minor}`);
  if (num(salesCell?.lines[salesCell.lines.length - 1]) !== f.qty) bad.push(`${tag}: pieces "${salesCell?.lines.join('|')}" ≠ ${f.qty}`);
  const disc = cells[i++];
  if (num(disc?.titles[0]) !== f.discount_minor) bad.push(`${tag}: Discount ${disc?.titles[0]} ≠ ${f.discount_minor}`);
  if (canCost) {
    const p = cells[i++];
    if (f.profit_minor === null) {
      if (!dashCell(p)) bad.push(`${tag}: Gross profit should be a dash, got "${p?.text}"`);
    } else {
      if (num(p?.titles[0]) !== f.profit_minor) bad.push(`${tag}: Gross profit ${p?.titles[0]} ≠ ${f.profit_minor}`);
      const m = marginOf(f);
      if (m !== null && !near(pct(p?.lines[p.lines.length - 1]), m)) bad.push(`${tag}: margin "${p?.lines.join('|')}" ≠ ${m.toFixed(1)}%`);
    }
  }
  if (stock) {
    const s = cells[i++];
    if (f.stock === null) {
      if (!dashCell(s)) bad.push(`${tag}: Stock should be a dash, got "${s?.text}"`);
    } else {
      if (num(s?.lines[0]) !== f.stock) bad.push(`${tag}: Stock "${s?.lines[0]}" ≠ ${f.stock}`);
      if (canCost && f.stock_cost_minor !== null && num(s?.titles[0]) !== f.stock_cost_minor) bad.push(`${tag}: Stock acq ${s?.titles[0]} ≠ ${f.stock_cost_minor}`);
    }
  }
  const share = cells[i++];
  const want = shareOf(f, total);
  if (want === null ? share?.text !== '—' : !near(pct(share?.text), want)) bad.push(`${tag}: Share "${share?.text}" ≠ ${want?.toFixed(1)}%`);
  return bad;
}

/** Payment table: Transactions · Collected · Per transaction · Share. */
export function paymentRowProblems(cells: Cell[], f: Json, total: Json, tag: string): string[] {
  const bad: string[] = [];
  if (f.receipts === null ? !dashCell(cells[1]) : num(cells[1]?.text) !== f.receipts) bad.push(`${tag}: Transactions "${cells[1]?.text}" ≠ ${f.receipts}`);
  if (num(cells[2]?.titles[0]) !== f.sales_minor) bad.push(`${tag}: Collected ${cells[2]?.titles[0]} ≠ ${f.sales_minor}`);
  if (f.receipts) {
    if (num(cells[3]?.text) !== Math.round(f.sales_minor / f.receipts)) bad.push(`${tag}: Per transaction "${cells[3]?.text}" ≠ ${Math.round(f.sales_minor / f.receipts)}`);
  }
  const want = shareOf(f, total);
  if (want !== null && !near(pct(cells[4]?.text), want)) bad.push(`${tag}: Share "${cells[4]?.text}" ≠ ${want.toFixed(1)}%`);
  return bad;
}

/** The whole Totals table (rows in the server's order, then the Total foot). */
export function totalsTableProblems(group: string, grid: Grid, api: Json, canCost: boolean): string[] {
  const bad: string[] = [];
  const want = api.rows as Json[];
  if (grid.body.length !== Math.min(want.length, 100)) bad.push(`rows on screen ${grid.body.length} ≠ API ${Math.min(want.length, 100)} (rows_total ${api.rows_total})`);
  grid.body.forEach((cells, k) => {
    const row = want[k];
    if (!row) return;
    if (nameOf(cells[0]) !== row.label) bad.push(`row ${k + 1}: name "${nameOf(cells[0])}" ≠ "${row.label}"`);
    bad.push(...(group === 'payment' ? paymentRowProblems(cells, row.figures, api.total, row.label) : totalsRowProblems(group, cells, row.figures, api.total, canCost, row.label)));
  });
  const foot = grid.foot[0];
  if (!foot) bad.push('no Total row');
  else {
    if (foot[0].text !== 'Total') bad.push(`foot label "${foot[0].text}"`);
    if (group === 'payment') {
      if (num(foot[2]?.titles[0]) !== api.total.sales_minor) bad.push(`foot Collected ${foot[2]?.titles[0]} ≠ ${api.total.sales_minor}`);
      if (api.total.receipts !== null && num(foot[1]?.text) !== api.total.receipts) bad.push(`foot Transactions "${foot[1]?.text}" ≠ ${api.total.receipts}`);
    } else {
      bad.push(...totalsRowProblems(group, foot, api.total, api.total, canCost, 'Total').filter((m) => !m.includes('Share')));
      const share = foot[foot.length - 1]?.text;
      if (share !== '100%') bad.push(`foot Share "${share}" ≠ 100%`);
    }
  }
  return bad;
}

/** The per-store table: a column group per store, then the pinned Totals. */
export function storesTableProblems(group: string, grid: Grid, api: Json): string[] {
  const bad: string[] = [];
  const stock = !noStock(group);
  const pay = group === 'payment';
  const stores = api.stores as Json[];
  const heads = grid.heads[0] ?? [];
  const wantHeads = ['', ...stores.map((s) => (s.code ?? s.name).replace(/-TOKO$/i, '')), 'Totals'];
  if (JSON.stringify(heads.slice(1)) !== JSON.stringify(wantHeads.slice(1))) bad.push(`store heads ${heads.join(',')} ≠ ${wantHeads.join(',')}`);
  const cellsOf = (row: Json) => new Map<string, Json>((row.cells ?? []).map((c: Json) => [c.site_id, c.figures]));
  const checkStore = (c: Cell[], at: number, f: Json | undefined, tag: string) => {
    let i = at;
    if (stock) {
      const s = c[i++];
      if (f === undefined || f.stock === null) {
        if (!dashCell(s)) bad.push(`${tag}: stock should be a dash, got "${s?.text}"`);
      } else if (num(s?.lines[0]) !== f.stock) bad.push(`${tag}: stock "${s?.lines[0]}" ≠ ${f.stock}`);
    }
    const sales = c[i++];
    const none = f === undefined || (f.sales_minor === 0 && f.qty === 0);
    if (none) {
      if (!dashCell(sales)) bad.push(`${tag}: no sales, should be a dash, got "${sales?.text}"`);
    } else if (num(sales?.titles[0]) !== f.sales_minor) bad.push(`${tag}: sales ${sales?.titles[0]} ≠ ${f.sales_minor}`);
    return i;
  };
  const perRow = stock ? 2 : 1;
  grid.body.forEach((cells, k) => {
    const row = api.rows[k];
    if (!row) return;
    const tag = row.label;
    if (nameOf(cells[0]) !== row.label) bad.push(`row ${k + 1}: name "${nameOf(cells[0])}" ≠ "${row.label}"`);
    const byStore = cellsOf(row);
    stores.forEach((s, j) => checkStore(cells, 1 + j * perRow, byStore.get(s.site_id), `${tag} @ ${s.site_id}`));
    const pin = 1 + stores.length * perRow;
    if (num(cells[pin]?.titles[0]) !== row.figures.sales_minor) bad.push(`${tag}: Totals sales ${cells[pin]?.titles[0]} ≠ ${row.figures.sales_minor}`);
    if (pay) {
      if (row.figures.receipts !== null && num(cells[pin + 1]?.text) !== row.figures.receipts) bad.push(`${tag}: Totals transactions "${cells[pin + 1]?.text}" ≠ ${row.figures.receipts}`);
    } else if (stock && row.figures.stock !== null && num(cells[pin + 1]?.lines[0]) !== row.figures.stock) bad.push(`${tag}: Totals stock "${cells[pin + 1]?.lines[0]}" ≠ ${row.figures.stock}`);
  });
  const foot = grid.foot[0];
  if (foot) {
    const totals = new Map<string, Json>((api.store_totals ?? []).map((c: Json) => [c.site_id, c.figures]));
    stores.forEach((s, j) => {
      const f = totals.get(s.site_id);
      let i = 1 + j * perRow;
      if (stock) {
        const sc = foot[i++];
        if (f && f.stock !== null && num(sc?.lines[0]) !== f.stock) bad.push(`foot ${s.site_id}: stock "${sc?.lines[0]}" ≠ ${f.stock}`);
      }
      const sa = foot[i];
      const none = !f || (f.sales_minor === 0 && f.qty === 0);
      if (none ? !dashCell(sa) : num(sa?.titles[0]) !== f.sales_minor) bad.push(`foot ${s.site_id}: sales "${sa?.text}" ≠ ${f?.sales_minor}`);
    });
    const pin = 1 + stores.length * perRow;
    if (num(foot[pin]?.titles[0]) !== api.total.sales_minor) bad.push(`foot Totals sales ${foot[pin]?.titles[0]} ≠ ${api.total.sales_minor}`);
  } else bad.push('no Total row');
  return bad;
}

/** The Explorer's KPI strip against the response's `total`. */
export function kpiProblems(kpis: Kpi[], total: Json, canCost: boolean): string[] {
  const bad: string[] = [];
  const by = new Map(kpis.map((k) => [k.label, k]));
  const get = (label: string) => by.get(label);
  const want = ['Transactions', 'Sold', 'Sales', ...(canCost && total.cost_minor !== null ? ['Acquisition cost'] : []), ...(canCost ? ['Gross profit'] : []), 'Stock'];
  if (JSON.stringify(kpis.map((k) => k.label)) !== JSON.stringify(want)) bad.push(`KPI labels ${kpis.map((k) => k.label).join(',')} ≠ ${want.join(',')}`);
  const receipts = total.receipts ?? null;
  const tx = get('Transactions');
  if (tx) {
    if (receipts === null ? tx.value !== '—' : num(tx.value) !== receipts) bad.push(`Transactions "${tx.value}" ≠ ${receipts}`);
    const voided = total.voided_receipts ?? null;
    if (voided !== null && voided > 0) {
      if (num(tx.delta) !== voided || !/voided/.test(tx.delta)) bad.push(`voided line "${tx.delta}" ≠ ${voided} voided`);
    } else if (tx.delta !== '') bad.push(`voided line should be empty, got "${tx.delta}"`);
  }
  const sold = get('Sold');
  if (sold && num(sold.value) !== total.qty) bad.push(`Sold "${sold.value}" ≠ ${total.qty}`);
  const sales = get('Sales');
  if (sales) {
    if (num(sales.valueTitle) !== total.sales_minor) bad.push(`Sales ${sales.valueTitle} ≠ ${total.sales_minor}`);
    if (!compactOk(sales.value, total.sales_minor)) bad.push(`Sales compact "${sales.value}" ≠ ${total.sales_minor}`);
    if (!/discount/.test(sales.delta)) bad.push(`Sales delta "${sales.delta}"`);
    else {
      const d = /Rp\s?[\d.,]+\s?[KMBT]?\s+discount/.exec(sales.delta)?.[0].replace(/\s*discount/, '');
      if (!compactOk(d, total.discount_minor)) bad.push(`discount "${d}" ≠ ${total.discount_minor}`);
      if (receipts) {
        const avg = /avg\s+(Rp\s?[\d.,]+\s?[KMBT]?)/.exec(sales.delta)?.[1];
        if (!compactOk(avg, total.sales_minor / receipts)) bad.push(`avg "${avg}" ≠ ${Math.round(total.sales_minor / receipts)}`);
      }
    }
  }
  const cost = get('Acquisition cost');
  if (cost && num(cost.valueTitle) !== total.cost_minor) bad.push(`Acquisition cost ${cost.valueTitle} ≠ ${total.cost_minor}`);
  const profit = get('Gross profit');
  if (profit) {
    if (num(profit.valueTitle) !== total.profit_minor) bad.push(`Gross profit ${profit.valueTitle} ≠ ${total.profit_minor}`);
    const m = marginOf(total);
    if (m !== null && !near(pct(profit.delta), m)) bad.push(`margin "${profit.delta}" ≠ ${m.toFixed(1)}%`);
  }
  const st = get('Stock');
  if (st) {
    if (total.stock === null ? st.value !== '—' : num(st.value) !== total.stock) bad.push(`Stock "${st.value}" ≠ ${total.stock}`);
    if (canCost && total.stock_cost_minor !== null && !compactOk(st.delta.replace(/\s*at acquisition/, ''), total.stock_cost_minor)) bad.push(`stock acq "${st.delta}" ≠ ${total.stock_cost_minor}`);
  }
  return bad;
}

// ── xlsx (the Export button) ────────────────────────────────────────────────

/** Find a file the browser saved: of every file with that name under the output folder, the newest. */
export function locateDownload(rel: string, suggested: string): string {
  const hits: { path: string; at: number }[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 10 || !existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (p.endsWith(rel) || name === suggested) hits.push({ path: p, at: st.mtimeMs });
    }
  };
  walk('.e2e/out', 0);
  if (hits.length === 0) throw new Error(`downloaded file ${rel} not found`);
  return hits.sort((x, y) => y.at - x.at)[0].path;
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The first worksheet of an .xlsx as rows of strings/numbers (unzip + a small XML read). */
export function readXlsx(path: string): { sheet: string; rows: (string | number | null)[][] } {
  const zip = readFileSync(path);
  // A zip by hand: find the central directory, then inflate the member asked for.
  const unzip = (member: string) => {
    let end = zip.length - 22;
    while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
    if (end < 0) return '';
    const count = zip.readUInt16LE(end + 10);
    let at = zip.readUInt32LE(end + 16);
    for (let i = 0; i < count; i++) {
      const method = zip.readUInt16LE(at + 10);
      const size = zip.readUInt32LE(at + 20);
      const nameLen = zip.readUInt16LE(at + 28);
      const extraLen = zip.readUInt16LE(at + 30);
      const commentLen = zip.readUInt16LE(at + 32);
      const local = zip.readUInt32LE(at + 42);
      const name = zip.toString('utf8', at + 46, at + 46 + nameLen);
      if (name === member) {
        const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
        const data = zip.subarray(start, start + size);
        return (method === 0 ? data : inflateRawSync(data)).toString('utf8');
      }
      at += 46 + nameLen + extraLen + commentLen;
    }
    return '';
  };
  const shared = [...unzip('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescapeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const workbook = unzip('xl/workbook.xml');
  const sheet = unescapeXml(/<sheet [^>]*name="([^"]*)"/.exec(workbook)?.[1] ?? '');
  const xml = unzip('xl/worksheets/sheet1.xml');
  const col = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const rows: (string | number | null)[][] = [];
  for (const r of xml.matchAll(/<row [^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const line: (string | number | null)[] = [];
    for (const c of (r[1] ?? '').matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '';
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      const body = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1];
      let value: string | number | null = null;
      if (type === 's' && v !== undefined) value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr' && inline !== undefined) value = unescapeXml(inline);
      else if (v !== undefined) value = type === 'str' ? unescapeXml(v) : Number(v);
      line[col(ref)] = value;
    }
    rows.push(Array.from(line, (x) => x ?? null));
  }
  return { sheet, rows };
}

// ── other endpoints ─────────────────────────────────────────────────────────

export const breakdown = (by: string, from: string, to: string, extra: Record<string, string> = {}): Promise<Json> =>
  cloud().get(`/api/v1/reports/sales/breakdown?${new URLSearchParams({ by, from, to, ...extra })}`);
export const series = (from: string, to: string, bucket: string): Promise<Json> => cloud().get(`/api/v1/reports/sales/series?${new URLSearchParams({ from, to, bucket })}`);
export const windowReport = (siteId: string, from: string, to: string, limit = 100): Promise<Json> =>
  cloud().get(`/api/v1/reports/sales/window?${new URLSearchParams({ site_id: siteId, from, to, limit: String(limit) })}`);
export const centreSales = async (limit = 500): Promise<Json[]> => rowsOf(await cloud().get(`/api/v1/sales?limit=${limit}`));
export const returnsList = (q = ''): Promise<Json> => cloud().get(`/api/v1/returns?limit=100${q}`);
export const customerSummary = (id: string): Promise<Json> => cloud().get(`/api/v1/customer/${encodeURIComponent(id)}/summary`);
export const customerSales = (id: string): Promise<Json> => cloud().get(`/api/v1/customer/${encodeURIComponent(id)}/transactions?limit=25`);


// ── one call: "the Explorer on screen equals the API for this question" ──────

const nf = (n: number) => n.toLocaleString('id-ID');

export interface ExplorerShown {
  grid: Grid;
  kpis: Kpi[];
  rowsLine: string | null;
  quietLine: string | null;
  emptyLine: string | null;
}

export async function readExplorer(browser: Evaluator, nouns: string[]): Promise<ExplorerShown> {
  const lines = (await browser.evaluate((arg: string) => {
    const nouns = JSON.parse(arg) as string[];
    const texts = (Array.from(document.querySelectorAll('span, p, div')) as HTMLElement[])
      .filter((e) => e.children.length === 0 || e.tagName === 'P')
      .map((e) => e.innerText?.replace(/\s+/g, ' ').trim() ?? '');
    return {
      rowsLine: texts.find((t) => new RegExp(`^[\\d.]+( of [\\d.]+)? (${nouns.join('|')})$`).test(t)) ?? null,
      quietLine: texts.find((t) => /· [\d.]+ stores?( · Updating)?$/.test(t)) ?? null,
      emptyLine: texts.find((t) => /^(Nothing sold in this period|No match\.)/.test(t)) ?? null,
    };
  }, JSON.stringify(nouns))) as { rowsLine: string | null; quietLine: string | null; emptyLine: string | null };
  return { grid: await readGrid(browser), kpis: await readKpis(browser), ...lines };
}

/**
 * The Explorer as it stands (the question is already in the address bar) against
 * the API for `args`: tab, KPI strip, rows, Total, row count, period line, or the
 * empty sentence when the API has no rows.
 */
export async function explorerMatches(
  ctx: { screen: any; browser: any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  args: ExplorerArgs,
  opts: { view?: 'totals' | 'stores'; emptyText?: string } = {},
): Promise<{ api: Json; shown: ExplorerShown }> {
  const { screen, browser } = ctx;
  const g = GROUPS.find((x) => x.value === args.group)!;
  const view = opts.view ?? 'totals';
  const got = await agree({
    api: () => explorer({ ...args, matrix: view === 'stores' && args.group !== 'store' }),
    read: async () => {
      // The table is a moment behind the tab that was just pressed: read once it has rows or says it has none.
      const end = Date.now() + 90_000;
      let shown = await readExplorer(browser, [g.one, g.many]);
      while (Date.now() < end && !(shown.kpis.length > 0 && (shown.grid.body.length > 0 || shown.emptyLine))) {
        await new Promise((r) => setTimeout(r, 1000));
        shown = await readExplorer(browser, [g.one, g.many]);
      }
      return shown;
    },
    stable: (api) => [api.total, api.rows.map((r: Json) => [r.key, r.figures]), api.rows_total, api.store_totals],
    check: (s, api) => {
      const bad: string[] = [];
      const canCost = api.can_see_cost as boolean;
      const n = api.rows_total as number;
      const rowsOnScreen = s.grid.body.length;
      const stores = api.stores.length as number;
      if (!s.quietLine?.includes(`${periodLabel(args.from, args.to)} · ${stores} ${stores === 1 ? 'store' : 'stores'}`)) bad.push(`period line "${s.quietLine}" ≠ ${periodLabel(args.from, args.to)} · ${stores} stores`);
      bad.push(...kpiProblems(s.kpis, api.total, canCost));
      const want = `${n} ${n === 1 ? g.one : g.many}`.replace(/^(\d+)/, (d) => nf(Number(d)));
      if (n === 0) {
        if (rowsOnScreen !== 0) bad.push(`API has no rows but the screen shows ${rowsOnScreen}`);
        if (opts.emptyText !== undefined && s.emptyLine !== opts.emptyText) bad.push(`empty sentence "${s.emptyLine}" ≠ "${opts.emptyText}"`);
        if (opts.emptyText === undefined && !s.emptyLine) bad.push('no empty sentence');
        if (s.rowsLine !== want) bad.push(`row count line "${s.rowsLine}" ≠ "${want}"`);
        return bad;
      }
      if (s.grid.heads[0]?.[0] !== g.label) bad.push(`first column "${s.grid.heads[0]?.[0]}" ≠ ${g.label}`);
      const shownRows = Math.min(n, 100);
      const wantLine = shownRows < n ? `${nf(shownRows)} of ${nf(n)} ${g.many}` : want;
      if (s.rowsLine !== wantLine) bad.push(`row count line "${s.rowsLine}" ≠ "${wantLine}"`);
      bad.push(...(view === 'stores' && args.group !== 'store' ? storesTableProblems(args.group, s.grid, api) : totalsTableProblems(args.group, s.grid, api, canCost)));
      return bad;
    },
    reload: async () => {
      await browser.reload();
      await screen.getByRole('textbox', `Search ${g.many}`).waitFor({ state: 'visible', timeout: 120_000 });
    },
  });
  expect(got.problems, `${explorerPath(args)} on ${await browser.url()}`).toEqual([]);
  return { api: got.api, shown: got.screen };
}

/** Rupiah the way the kit writes it in full: "Rp 498.000" (negative with a true minus). */
export const rp = (n: number) => `${n < 0 ? '−' : ''}Rp ${Math.abs(Math.round(n)).toLocaleString('id-ID')}`;
export const fmtCount = (n: number) => n.toLocaleString('id-ID');

// ── the ten "Sales by …" screens (breakdown.tsx) ─────────────────────────────

export const BY = [
  { by: 'store', path: '/sales/by-store', title: 'Sales by store', noun: 'Store', none: 'Unassigned', search: 'Search stores', oneShop: true },
  { by: 'division', path: '/sales/by-division', title: 'Sales by division', noun: 'Division', none: 'Unclassified', search: 'Search divisions', oneShop: false },
  { by: 'tag', path: '/sales/by-tag', title: 'Sales by tag', noun: 'Tag', none: 'Untagged', search: 'Search tags', oneShop: false },
  { by: 'article', path: '/sales/by-article', title: 'Sales by article', noun: 'Article', none: 'Unknown article', search: 'Search article code or name', oneShop: false },
  { by: 'sku', path: '/sales/by-sku', title: 'Sales by SKU', noun: 'SKU', none: 'Unknown SKU', search: 'Search SKU or article', oneShop: false },
  { by: 'po', path: '/sales/by-po', title: 'Sales by PO', noun: 'PO', none: 'No PO', search: 'Search PO number or supplier', oneShop: false },
  { by: 'supplier', path: '/sales/by-supplier', title: 'Sales by supplier', noun: 'Supplier', none: 'No supplier', search: 'Search suppliers', oneShop: false },
  { by: 'campaign', path: '/sales/by-campaign', title: 'Sales by campaign', noun: 'Campaign', none: 'No campaign', search: 'Search campaigns', oneShop: false },
  { by: 'payment', path: '/sales/by-payment', title: 'Sales by payment', noun: 'Payment', none: 'Not recorded', search: 'Search payments', oneShop: false },
  { by: 'session', path: '/sales/by-session', title: 'Sales by cashier session', noun: 'Session', none: 'No session', search: 'Search sessions', oneShop: true },
] as const;
export type By = (typeof BY)[number];

/** One breakdown table (All, or Per store) against GET /reports/sales/breakdown. */
export function breakdownProblems(kind: By, grid: Grid, api: Json, perStore: boolean, needle = ''): string[] {
  const bad: string[] = [];
  const hasStock = api.has_stock as boolean;
  const sites = api.sites as Json[];
  const cellKey = (code: string, site: string) => `${code}\u0000${site}`;
  const cells = new Map<string, Json>((api.cells as Json[]).map((c) => [cellKey(c.code, c.site_id), c]));
  const siteTotals = new Map<string, Json>((api.site_totals as Json[]).map((c) => [c.site_id, c]));
  const q = needle.trim().toLowerCase();
  const wanted = (api.rows as Json[]).filter((r) => q === '' || `${r.name} ${r.code}`.toLowerCase().includes(q));
  const body = grid.body;
  if (body.length !== wanted.length + 1) bad.push(`rows on screen ${body.length - 1} ≠ API ${wanted.length}`);
  const dash = (c: Cell | undefined) => c !== undefined && c.text === '—';
  const figure = (c: Cell | undefined, want: number | undefined, money: boolean, plain: boolean, tag: string) => {
    if (want === undefined || (want === 0 && !plain)) {
      if (!dash(c)) bad.push(`${tag}: should be a dash, got "${c?.text}"`);
    } else if (num(c?.text) !== want) bad.push(`${tag}: ${money ? 'Sales' : 'count'} "${c?.text}" ≠ ${want}`);
  };
  const group = (line: Cell[], at: number, f: { stock?: number; quantity?: number; net_minor?: number } | undefined, plain: boolean, tag: string) => {
    let i = at;
    if (hasStock) figure(line[i++], f?.stock, false, plain, `${tag} stock`);
    figure(line[i++], f?.quantity, false, plain, `${tag} qty`);
    figure(line[i++], f?.net_minor, true, plain, `${tag} sales`);
    return i;
  };
  wanted.forEach((row, k) => {
    const line = body[k];
    if (!line) return;
    const name = row.code === '' ? kind.none : row.name;
    if (line[0].text !== name) bad.push(`row ${k + 1}: name "${line[0].text}" ≠ "${name}"`);
    if (!perStore) group(line, 1, row, true, row.name);
    else {
      sites.forEach((s, j) => group(line, 1 + j * (hasStock ? 3 : 2), cells.get(cellKey(row.code, s.site_id)), false, `${row.name} @ ${s.site_id}`));
      group(line, 1 + sites.length * (hasStock ? 3 : 2), row, false, `${row.name} @ All`); // a zero is a dash here too
    }
  });
  const total = body[body.length - 1];
  if (!total || total[0].text !== 'Total') bad.push(`last row is "${total?.[0].text}", not Total`);
  else if (q === '') {
    if (!perStore) group(total, 1, api.total, true, 'Total');
    else {
      sites.forEach((s, j) => group(total, 1 + j * (hasStock ? 3 : 2), siteTotals.get(s.site_id), false, `Total @ ${s.site_id}`));
      group(total, 1 + sites.length * (hasStock ? 3 : 2), api.total, true, 'Total @ All');
    }
  }
  const heads = grid.heads;
  const wantHead = perStore ? [kind.noun, ...sites.map((s) => s.name), 'All'] : [kind.noun, ...(hasStock ? ['Stock'] : []), 'Quantity sold', 'Sales'];
  if (JSON.stringify(heads[0]) !== JSON.stringify(wantHead)) bad.push(`heads ${JSON.stringify(heads[0])} ≠ ${JSON.stringify(wantHead)}`);
  return bad;
}

export interface Race {
  label: string;
  total: string | null;
  more: string | null;
  bars: { name: string; value: string }[];
}
/** The replaying bar chart: what is standing on the scrubber, its visible bars, the running total. */
export async function readRace(browser: Evaluator): Promise<Race> {
  return (await browser.evaluate((_: string) => {
    const list = document.querySelector('[role="list"][aria-label]') as HTMLElement | null;
    const texts = (Array.from(document.querySelectorAll('div, p')) as HTMLElement[]).map((e) => (e.children.length === 0 ? e.innerText.trim() : ''));
    return {
      label: (list?.getAttribute('aria-label') ?? '').split(', ').slice(1).join(', '),
      total: texts.find((t) => /^Total Rp/.test(t)) ?? null,
      more: texts.find((t) => /^\+\d+ more in the table$/.test(t)) ?? null,
      bars: Array.from(list?.querySelectorAll('[role="listitem"]') ?? [])
        .filter((el) => el.getAttribute('aria-hidden') !== 'true')
        .map((el) => {
          const lines = (el as HTMLElement).innerText.split('\n').map((s) => s.trim()).filter(Boolean);
          return { name: el.querySelector('span[title]')?.getAttribute('title') ?? lines[0] ?? '', value: lines[lines.length - 1] ?? '' };
        }),
    };
  }, '')) as Race;
}

// ── /sales (the trading days) and /sales/analytics: the shared calendar ─────

export type Bucket = 'day' | 'week' | 'month';
export const SPANS: Record<Bucket, number[]> = { day: [7, 14, 30, 90], week: [8, 13, 26, 52], month: [6, 12, 24] };
export const OPENS_ON: Record<Bucket, number> = { day: 30, week: 13, month: 12 };
const noon = (iso: string) => new Date(`${iso}T12:00:00`);
const isoOfDate = (d: Date) => iso(d);

export function spanOf(bucket: Bucket, buckets: number, today = jakartaToday()) {
  const t = noon(today);
  if (bucket === 'day') {
    const s = new Date(t);
    s.setDate(s.getDate() - (buckets - 1));
    return { from: isoOfDate(s), to: today, bucket };
  }
  if (bucket === 'week') {
    const monday = new Date(t);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 7 * (buckets - 1));
    return { from: isoOfDate(monday), to: today, bucket };
  }
  const s = new Date(t);
  s.setDate(1);
  s.setMonth(s.getMonth() - (buckets - 1));
  return { from: isoOfDate(s), to: today, bucket };
}

export function previousSpanOf(bucket: Bucket, buckets: number, today = jakartaToday()) {
  const current = spanOf(bucket, buckets, today);
  const from = noon(current.from);
  const to = new Date(from);
  to.setDate(to.getDate() - 1);
  const start = new Date(from);
  if (bucket === 'day') start.setDate(start.getDate() - buckets);
  else if (bucket === 'week') start.setDate(start.getDate() - 7 * buckets);
  else start.setMonth(start.getMonth() - buckets);
  return { from: isoOfDate(start), to: isoOfDate(to), bucket };
}

/** bucketTitle() of the contract: "10 Sept 2026", "Week of 5 Oct 2026 – 11 Oct", "October 2026". */
export function bucketTitle(start: string, bucket: Bucket): string {
  const date = noon(start);
  if (bucket === 'month') return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (bucket === 'week') {
    const end = new Date(date);
    end.setDate(end.getDate() + 6);
    return `Week of ${day} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  }
  return day;
}

export function growthLabel(fraction: number): string {
  const p = fraction * 100;
  const sign = p > 0 ? '+' : p < 0 ? '−' : '';
  const m = Math.abs(p);
  return `${sign}${m >= 100 ? Math.round(m) : m.toFixed(m < 10 ? 1 : 0)}%`;
}

/** The series, indexed the way matrix.ts does it. */
export function matrixOf(series: Json, focus: string | null = null) {
  const cell = new Map<string, Json>((series.cells as Json[]).map((c) => [`${c.site_id}|${c.bucket_start}`, c]));
  const sites = (series.sites as Json[]).filter((s) => focus === null || s.site_id === focus);
  const sum = (bucket: string | null, siteId: string | null, field: 'gross_minor' | 'sales_count' | 'units_sold') =>
    sites
      .filter((s) => siteId === null || s.site_id === siteId)
      .reduce((t, s) => t + (bucket === null ? (series.buckets as string[]).reduce((u, b) => u + (cell.get(`${s.site_id}|${b}`)?.[field] ?? 0), 0) : (cell.get(`${s.site_id}|${bucket}`)?.[field] ?? 0)), 0);
  const measure = (kind: SalesKind, f: (field: 'gross_minor' | 'sales_count' | 'units_sold') => number) => {
    if (kind === 'average_minor') return f('sales_count') === 0 ? 0 : f('gross_minor') / f('sales_count');
    if (kind === 'items_per_sale') return f('sales_count') === 0 ? 0 : f('units_sold') / f('sales_count');
    return f(kind);
  };
  return {
    buckets: series.buckets as string[],
    sites,
    bucket: (b: string, kind: SalesKind) => measure(kind, (f) => sum(b, null, f)),
    site: (siteId: string, b: string | null, kind: SalesKind) => measure(kind, (f) => sum(b, siteId, f)),
    grand: (kind: SalesKind) => measure(kind, (f) => sum(null, null, f)),
    traded: (b: string) => sites.filter((s) => (cell.get(`${s.site_id}|${b}`)?.sales_count ?? 0) > 0),
  };
}
export type SalesKind = 'gross_minor' | 'sales_count' | 'units_sold' | 'average_minor' | 'items_per_sale';
/** showSales(): money to the rupiah, UPT to one decimal, the rest counted. */
export function showSales(kind: SalesKind, value: number): string {
  if (kind === 'gross_minor' || kind === 'average_minor') return rp(Math.round(value));
  if (kind === 'items_per_sale') return value.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return fmtCount(value);
}
export const SALES_KINDS: { kind: SalesKind; label: string; hint: string }[] = [
  { kind: 'gross_minor', label: 'TAKINGS', hint: 'Gross, tax in' },
  { kind: 'sales_count', label: 'TRANSACTIONS', hint: 'Completed sales' },
  { kind: 'average_minor', label: 'AVG TRANSACTION', hint: 'ATV' },
  { kind: 'units_sold', label: 'UNITS', hint: 'Pcs sold' },
  { kind: 'items_per_sale', label: 'UNITS PER SALE', hint: 'UPT' },
];

/** What a Delta cell says (delta.tsx): "new", "—", "→ 0%", "↑ +12%". */
export function deltaText(now: number, before: number): string {
  if (before === 0) return now > 0 ? 'new' : '—';
  const f = (now - before) / before;
  if (Math.abs(f) < 0.005) return '→ 0%';
  return `${f > 0 ? '↑' : '↓'} ${growthLabel(f)}`;
}

/** The days table (one row per bucket, newest first) and its Whole span foot, against the series. */
export function daysProblems(
  grid: Grid,
  series: Json,
  bucket: Bucket,
  opts: { before?: Json; short?: string; focus?: string | null; today?: string } = {},
): string[] {
  const bad: string[] = [];
  const focus = opts.focus ?? null;
  const m = matrixOf(series, focus);
  const before = opts.before ? matrixOf(opts.before, focus) : undefined;
  const alone = m.sites.length === 1;
  const cmp = before !== undefined;
  const heads = grid.heads[0] ?? [];
  const wantHead = [bucket === 'day' ? 'Day' : bucket === 'week' ? 'Week' : 'Month', 'Takings', ...(cmp ? [opts.short ?? 'vs prev'] : []), 'Transactions', 'Avg transaction', 'Units', 'UPT', ...(alone ? [] : ['Shops'])];
  if (JSON.stringify(heads) !== JSON.stringify(wantHead)) bad.push(`heads ${JSON.stringify(heads)} ≠ ${JSON.stringify(wantHead)}`);
  const order = [...m.buckets].reverse();
  if (grid.body.length !== order.length) bad.push(`day rows ${grid.body.length} ≠ ${order.length}`);
  const today = opts.today ?? jakartaToday();
  order.forEach((start, k) => {
    const cells = grid.body[k];
    if (!cells) return;
    const title = bucketTitle(start, bucket);
    if (!(cells[0]?.text ?? '').startsWith(title)) bad.push(`row ${k + 1}: "${(cells[0]?.text ?? '')}" ≠ "${title}"`);
    const takings = m.bucket(start, 'gross_minor');
    let i = 1;
    const quiet = takings === 0;
    const want = quiet ? '–' : showSales('gross_minor', takings);
    if ((cells[i++]?.text ?? '') !== want) bad.push(`${title}: takings "${(cells[i - 1]?.text ?? '')}" ≠ "${want}"`);
    if (cmp) {
      const wasBucket = before!.buckets[m.buckets.indexOf(start)];
      const text = cells[i++]?.text ?? '';
      const wantDelta = wasBucket === undefined ? '·' : deltaText(takings, before!.bucket(wasBucket, 'gross_minor'));
      if (!(wantDelta.startsWith('↑') || wantDelta.startsWith('↓') ? text.startsWith(wantDelta[0]) : text === wantDelta)) bad.push(`${title}: ${opts.short} "${text}" ≠ "${wantDelta}"`);
    }
    for (const kind of ['sales_count', 'average_minor', 'units_sold', 'items_per_sale'] as SalesKind[]) {
      const v = m.bucket(start, kind);
      const w = v === 0 ? '–' : showSales(kind, v);
      const got = (cells[i++]?.text ?? '');
      if (got !== w) bad.push(`${title}: ${kind} "${got}" ≠ "${w}"`);
    }
    if (!alone) {
      const n = m.traded(start).length;
      const w = n === 0 ? '–' : String(n);
      if ((cells[i]?.text ?? '') !== w) bad.push(`${title}: shops "${(cells[i]?.text ?? '')}" ≠ ${w}`);
    }
    const live = start <= today && (bucket === 'day' ? start : bucket === 'week' ? bucketEndIso(start, 'week') : bucketEndIso(start, 'month')) >= today;
    if (live !== /\bLive\b/.test((cells[0]?.text ?? ''))) bad.push(`${title}: Live pill ${live ? 'missing' : 'should not show'}`);
  });
  const foot = grid.foot[0];
  if (!foot) bad.push('no Whole span row');
  else {
    const label = alone ? m.sites[0].site_name : 'Whole span';
    if ((foot[0]?.text ?? '') !== label) bad.push(`foot label "${(foot[0]?.text ?? '')}" ≠ ${label}`);
    let i = 1;
    if ((foot[i++]?.text ?? '') !== showSales('gross_minor', m.grand('gross_minor'))) bad.push(`foot takings "${(foot[i - 1]?.text ?? '')}" ≠ ${showSales('gross_minor', m.grand('gross_minor'))}`);
    if (cmp) i++;
    for (const kind of ['sales_count', 'average_minor', 'units_sold', 'items_per_sale'] as SalesKind[]) {
      const w = showSales(kind, m.grand(kind));
      if ((foot[i++]?.text ?? '') !== w) bad.push(`foot ${kind} "${(foot[i - 1]?.text ?? '')}" ≠ ${w}`);
    }
    if (!alone) {
      const n = m.sites.filter((s) => m.site(s.site_id, null, 'sales_count') > 0).length;
      if ((foot[i]?.text ?? '') !== String(n)) bad.push(`foot shops "${(foot[i]?.text ?? '')}" ≠ ${n}`);
    }
  }
  return bad;
}

export function bucketEndIso(start: string, bucket: Bucket): string {
  const d = noon(start);
  if (bucket === 'day') return start;
  if (bucket === 'week') {
    d.setDate(d.getDate() + 6);
    return isoOfDate(d);
  }
  return isoOfDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** The five tiles over the chart: label, figure. */
export async function readTiles(browser: Evaluator): Promise<{ label: string; value: string; pressed: boolean; sub: string }[]> {
  return (await browser.evaluate((_: string) =>
    (Array.from(document.querySelectorAll('button[aria-pressed]')) as HTMLElement[])
      .filter((b) => /^(TAKINGS|TRANSACTIONS|AVG TRANSACTION|UNITS|UNITS PER SALE)\s/.test(b.innerText.replace(/\s+/g, ' ').trim()))
      .map((b) => {
        const lines = b.innerText.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
        return { label: lines[0], value: lines[1], sub: lines.slice(2).join(' '), pressed: b.getAttribute('aria-pressed') === 'true' };
      }), '')) as { label: string; value: string; pressed: boolean; sub: string }[];
}

// ── /sales/analytics (Sales Analytics: the estate, a row per store) ─────────

export function percentText(share: number): string {
  // percent(x, {digits: 1}) — at most one decimal, comma, no padding
  const v = Math.round(share * 1000) / 10;
  return `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
}

/** The store table of Sales Analytics against the series and the span before it. */
export function analyticsProblems(grid: Grid, now: Json, before: Json, sortKey: 'gross_minor' | 'sales_count' | 'units_sold' | 'average_minor' | null = 'gross_minor', desc = true): string[] {
  const bad: string[] = [];
  const m = matrixOf(now);
  const mb = matrixOf(before);
  const estate = m.grand('gross_minor');
  const wantHead = ['Store', 'Trend', 'Takings', 'Share', 'Vs Before', 'Transactions', 'Avg Transaction', 'Units', 'UPT'];
  const heads = grid.heads[0] ?? [];
  if (JSON.stringify(heads) !== JSON.stringify(wantHead)) bad.push(`heads ${JSON.stringify(heads)} ≠ ${JSON.stringify(wantHead)}`);
  if (grid.body.length !== m.sites.length) bad.push(`rows ${grid.body.length} ≠ stores ${m.sites.length}`);
  const rows = new Map<string, Cell[]>(grid.body.map((c) => [c[0].text, c]));
  for (const site of m.sites) {
    const c = rows.get(site.site_name);
    if (!c) {
      bad.push(`no row for ${site.site_name}`);
      continue;
    }
    const gross = m.site(site.site_id, null, 'gross_minor');
    const was = mb.site(site.site_id, null, 'gross_minor');
    const share = estate === 0 ? 0 : gross / estate;
    if (c[2]?.text !== rp(gross)) bad.push(`${site.site_name}: takings "${c[2]?.text}" ≠ ${rp(gross)}`);
    if (!near(pct(c[3]?.text), share * 100)) bad.push(`${site.site_name}: share "${c[3]?.text}" ≠ ${(share * 100).toFixed(1)}%`);
    const growth = was === 0 ? null : (gross - was) / was;
    const wantGrowth = growth === null ? 'new' : growthLabel(growth);
    if (c[4]?.text !== wantGrowth) bad.push(`${site.site_name}: vs before "${c[4]?.text}" ≠ "${wantGrowth}"`);
    if (c[5]?.text !== fmtCount(m.site(site.site_id, null, 'sales_count'))) bad.push(`${site.site_name}: transactions "${c[5]?.text}"`);
    if (c[6]?.text !== rp(Math.round(m.site(site.site_id, null, 'average_minor')))) bad.push(`${site.site_name}: avg "${c[6]?.text}" ≠ ${rp(Math.round(m.site(site.site_id, null, 'average_minor')))}`);
    if (c[7]?.text !== fmtCount(m.site(site.site_id, null, 'units_sold'))) bad.push(`${site.site_name}: units "${c[7]?.text}"`);
    if (c[8]?.text !== showSales('items_per_sale', m.site(site.site_id, null, 'items_per_sale'))) bad.push(`${site.site_name}: UPT "${c[8]?.text}"`);
  }
  if (sortKey !== null) {
    const idx: Record<string, number> = { gross_minor: 2, sales_count: 5, average_minor: 6, units_sold: 7 };
    const values = grid.body.map((c) => num(c[idx[sortKey]]?.text) ?? 0);
    const ok = values.every((v, i) => i === 0 || (desc ? values[i - 1] >= v : values[i - 1] <= v));
    if (!ok) bad.push(`not sorted ${desc ? 'high to low' : 'low to high'} by ${sortKey}: ${values.slice(0, 8).join(',')}…`);
  }
  return bad;
}

/** The Gaining / Losing ground cards: store names (or the empty sentence) under each title. */
export async function readMovers(browser: Evaluator): Promise<Record<string, string[]>> {
  return (await browser.evaluate((_: string) => {
    const out: Record<string, string[]> = {};
    for (const title of ['Gaining', 'Losing ground']) {
      const head = (Array.from(document.querySelectorAll('h3, h2, div, span')) as HTMLElement[]).find((e) => e.children.length === 0 && e.innerText.trim() === title);
      const card = head?.closest('.overflow-hidden') as HTMLElement | null;
      out[title] = (card?.innerText ?? '').split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(1);
    }
    return out;
  }, '')) as Record<string, string[]>;
}
