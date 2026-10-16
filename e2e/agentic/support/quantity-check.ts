// Quantity Checks: head office asks the warehouse to count a delivery by colour and size (New Articles), the
// warehouse answers in Operations › Quantity Checks, and the answer stands as a reference in New Articles.
// Hub source: screens/procurement/setup-quantity-check.tsx (the request + the box), setups.tsx (the form and
// the Draft mark), screens/operations/quantity-checks/quantity-checks.tsx (the warehouse sheet).
// Routes: GET/POST /api/v1/quantity-checks, POST /api/v1/quantity-checks/{id}/count,
//         GET/PUT/DELETE /api/v1/article-setups/drafts/{receipt_line_id}.
import { expect } from 'e2e';
import { makeItemFast } from './po.ts';
import { as, deliver, nudge, placePo, rows, tag, waitFor, type ItemCtx } from './rig.ts';
import type { Person } from './base.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Screen = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type App = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export { tag };

export const SLOW = { timeout: 60_000 } as const;

export interface Line {
  t: string;
  ctx: ItemCtx;
  po: string;
  qty: number;
  /** The unidentified-receipt row (receipt_line_id, article_name, quantity, division_code, tags…). */
  row: Json;
  id: string;
  name: string;
}

/**
 * A PO of `qty` pieces (2 colours × 2 sizes, so qty/4 of each) on supplier 0001, counted exactly and accepted:
 * the line sits in New Articles waiting to be named. Built per test: asking a check changes the line.
 */
export async function waitingLine(qty = 8): Promise<Line> {
  const t = tag('QC');
  const ctx = await makeItemFast(t);
  const po = await placePo(ctx, qty, { notes: `Uji quantity check ${t}` });
  await deliver(ctx, po, qty, { review: 'Accept' });
  const row = await waitFor(`${po} in New Articles`, async () => {
    await nudge('dc', 'cloud');
    return rows(await as('cloud', 'rina').get('/api/v1/article-setups/unidentified')).find((r) => r.po_number === po);
  }, 180_000, 3_000);
  return { t, ctx, po, qty, row, id: row.receipt_line_id as string, name: row.article_name as string };
}

/** Every check of the line, newest first. */
export async function checksOf(line: Line): Promise<Json[]> {
  return (await as('cloud', 'rina').get(`/api/v1/quantity-checks?receipt_line_id=${line.id}`)) ?? [];
}

/** Ask for a count over the API, as New Articles does. */
export function ask(line: Line, over: Json = {}, who: Person = 'rina'): Promise<Json> {
  return as('cloud', who).post('/api/v1/quantity-checks', { receipt_line_id: line.id, article_name: line.name, ...over });
}

/** The combinations New Articles sends for the PO's 2 colours × 2 sizes: the article, then colour, then size. */
export async function expectedCells(line: Line): Promise<Json[]> {
  const [open] = (await checksOf(line)).filter((c) => c.status === 'REQUESTED');
  return open?.expected ?? [];
}

/** The warehouse answers: `lines` of {article?, colour, size, quantity ≥ 1}. */
export function answer(checkId: string, lines: Json[], who: Person = 'nina'): Promise<Json> {
  return as('cloud', who).post(`/api/v1/quantity-checks/${checkId}/count`, { lines });
}

/** The words the form shows for the PO's colours (BLACK, WHITE) and sizes (03, 04). */
export async function words(): Promise<{ colours: string[]; sizes: string[] }> {
  const cloud = as('cloud', 'rina');
  const colours = rows((await cloud.get('/api/v1/colours')).colours ?? []);
  const sizes = (await cloud.get('/api/v1/vocabulary/sizes')).terms as Json[];
  const colour = (code: string) => (colours.find((c) => c.code === code)?.label ?? code) as string;
  const size = (code: string) => (sizes.find((s) => s.code === code)?.label ?? code) as string;
  return { colours: ['BLACK', 'WHITE'].map(colour), sizes: ['03', '04'].map(size) };
}

/** The 4 combinations as the form sends them: for each colour (form order), each size (master order). */
export async function cellsOf(line: Line): Promise<Json[]> {
  const w = await words();
  return w.colours.flatMap((colour) => w.sizes.map((size) => ({ article: line.name, colour, size })));
}

/** Ask (with the 4 combinations, division and tags the form would send), then answer evenly over the pieces received. */
export async function askAndCount(line: Line, perCell = line.qty / 4): Promise<{ asked: Json; counted: Json }> {
  const asked = await ask(line, { expected: await cellsOf(line), division: 'PRIA', tags: ['KAOS'] });
  const counted = await answer(asked.check_id, asked.expected.map((c: Json) => ({ ...c, quantity: perCell })));
  return { asked, counted };
}

/** The line's New Articles sheet, by deep link. */
export async function openSetup(app: App, screen: Screen, line: Line) {
  await app.open(`/master/new-articles?receipt=${line.id}`);
  await expect(screen.getByRole('dialog').getByRole('button', 'Submit')).toBeVisible({ timeout: 90_000 });
}

/** Width of the open sheet in pixels (the dialog's own box). */
export async function sheetWidth(screen: Screen): Promise<number> {
  const box = await screen.getByRole('dialog').boundingBox();
  return Math.round(box?.width ?? 0);
}

/** The saved drafts of the server, by delivery line. */
export async function draftOf(line: Line): Promise<Json | null> {
  const res = await fetchDraft(line);
  return res;
}

async function fetchDraft(line: Line): Promise<Json | null> {
  try {
    return await as('cloud', 'rina').get(`/api/v1/article-setups/drafts/${line.id}`);
  } catch (error) {
    if (String((error as Error).message).includes('→ 404')) return null;
    throw error;
  }
}

export async function draftIds(): Promise<string[]> {
  return rows(await as('cloud', 'rina').get('/api/v1/article-setups/drafts')).map((d) => d.receipt_line_id as string);
}

/** The Ops › Quantity Checks list, and the row of one article by its name. */
export async function openChecksList(app: App, screen: Screen) {
  await app.open('/operations/quantity-checks');
  await expect(screen.getByRole('heading', 'Quantity Checks')).toBeVisible(SLOW);
}

export const checkRow = (screen: Screen, line: Line) => screen.getByRole('button').filter({ hasText: line.name });

/** The Ops sheet of one check, opened from the list. */
export async function openCheck(app: App, screen: Screen, line: Line) {
  await openChecksList(app, screen);
  const row = checkRow(screen, line);
  await expect(row).toBeVisible(SLOW);
  await row.tap();
  await expect(screen.getByRole('dialog')).toContainText('Supplier', { timeout: 30_000 });
}

/** The label of a warehouse sheet quantity box. */
export const qtyBox = (screen: Screen, article: string, colour: string, size: string) =>
  screen.getByLabel(`Quantity, ${article}, ${colour}, ${size}`);
