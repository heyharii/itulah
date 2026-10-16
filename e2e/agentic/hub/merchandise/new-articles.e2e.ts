// Master › New Articles (screens/procurement/setups.tsx, the page screens/master/new-articles.tsx).
// Goods that arrived without an identity are named here. It only mints NEW articles: a delivery line becomes one
// article (or sibling articles), never a match or an addition to an existing one.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import type { OwnStock } from '../../support/inventory.ts';
import { as, rows, waitFor } from '../../support/rig.ts';
import {
  articleDetail, cloudCall, createNameApi, deleteNameApi, newArticle, ownStock, rupiah, shared, SLOW, stillWaiting, tag, waitingLine,
} from '../../support/merchandise.ts';

const TAGS = ['merchandise', 'new-articles'];
const SUPPLIER = 'Garmen Nusantara, PT';

interface Line {
  stock: OwnStock;
  row: any;
  name: string;
}

async function waiting(stock: OwnStock): Promise<Line> {
  const row = await waitingLine(stock.poNumber);
  return { stock, row, name: row.article_name as string };
}

const stillThere = (l: Line) => stillWaiting(l.row.receipt_line_id);
const checksOf = async (l: Line): Promise<any[]> => (await cloudCall('GET', `/api/v1/quantity-checks?receipt_line_id=${l.row.receipt_line_id}`)).body ?? [];

/** A delivered line nobody has set up: the tests that only read the sheet share it. */
const readLine = () => shared('merch-line-read', async () => waiting(await ownStock(8, tag('NR'))), stillThere);
/** A line for the Quantity Check tests (a request changes the line, so the read-only tests do not use it). */
const makeCheckLine = async () => waiting(await ownStock(8, tag('NQ')));
const checkLine = () => shared('merch-line-check', makeCheckLine, async (l) => (await stillThere(l)) && (await checksOf(l)).length === 0);
/** The same line after its check was asked: still waiting is all it needs. */
const askedLine = () => shared('merch-line-check', makeCheckLine, stillThere);
/** A line already set up as two sibling articles. */
const splitArticle = () =>
  shared('merch-article-split', () => newArticle(8, tag('NP'), { split: true }), async (a) => (await cloudCall('GET', `/api/v1/articles/${a.codes[0]}`)).status === 200);

async function open(app: any, screen: any, line: Line) {
  await app.open(`/master/new-articles?receipt=${line.row.receipt_line_id}`);
  await expect(screen.getByRole('dialog').getByRole('button', 'Submit')).toBeVisible({ timeout: 90_000 });
}

const setupBody = (line: Line, over: Record<string, unknown> = {}) => ({
  receipt_line_id: line.row.receipt_line_id,
  article_code: null,
  article_name: line.name,
  division_code: 'PRIA',
  tags: ['KAOS'],
  image_url: null,
  currency: 'IDR',
  colours: [{ colour_digit: '1', colour_code: 'BLACK' }],
  variants: [{ colour_digit: '1', size_code: '03', quantity: 8, base_price_minor: 99_000 }],
  created_by: 'rina',
  ...over,
});

describe('Master New Articles', { session: 'rina', tags: TAGS, timeout: 700_000 }, () => {
  test('MER-90 a delivered line waits under its supplier with the PO, its quantity and when it arrived', { tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const read = await readLine();
    await app.open('/master/new-articles');
    await expect(screen.getByRole('heading', 'New Articles')).toBeVisible(SLOW);
    await screen.getByRole('combobox', 'Search New Articles').fill(read.name);
    const group = screen.getByRole('group', SUPPLIER);
    await expect(group).toContainText(read.name, { timeout: 90_000 });
    await expect(group).toContainText('8 pcs');
    await expect(group).toContainText(read.stock.poNumber);
    for (const kpi of ['New Articles', 'Pcs', 'Suppliers']) await expect(screen.getByText(kpi, { exact: true }).first()).toBeVisible();
  });

  test('MER-91 the search box takes an article name or a PO number and says when nothing matches', { tags: TAGS }, async ({ app, screen }) => {
    const read = await readLine();
    await app.open('/master/new-articles');
    const box = screen.getByRole('combobox', 'Search New Articles');
    await box.fill(read.stock.poNumber);
    await expect(screen.getByRole('group', SUPPLIER)).toContainText(read.name, { timeout: 90_000 });
    await box.fill(`zzz-${tag('Q')}`);
    await expect(screen.getByText('Nothing here matches that.')).toBeVisible(SLOW);
  });

  test('MER-92 the sheet opens already filled from the delivery: name, division, tags, price and the grid', { tags: TAGS }, async ({ app, screen }) => {
    const read = await readLine();
    await open(app, screen, read);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('combobox', { name: /^Name/ })).toHaveValue(new RegExp(read.stock.t, 'i'));
    await expect(sheet.getByRole('combobox', 'Division')).toHaveValue('Pria');
    await expect(sheet.getByText('Kaos', { exact: true }).first()).toBeVisible();
    await expect(sheet.getByRole('textbox', { name: /^Base Price/ })).toHaveValue('99.000');
    await expect(sheet).toContainText(`Purchase price ${rupiah(40_000)}`);
    await expect(sheet.getByRole('textbox', 'Markup')).toHaveValue('147.5');
    await expect(sheet).toContainText(SUPPLIER);
    await expect(sheet).toContainText('8 pcs');
    await expect(sheet).toContainText('8 of 8 · 4 SKUs');
    await expect(sheet.getByRole('button', 'Submit')).toBeEnabled();
  });

  test('MER-93 a base price at or under the purchase price is refused', { tags: TAGS }, async ({ app, screen }) => {
    const read = await readLine();
    await open(app, screen, read);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', { name: /^Base Price/ }).fill('40000');
    await expect(sheet.getByText(`Must be above the purchase price, ${rupiah(40_000)}`)).toBeVisible();
    await expect(sheet.getByRole('button', 'Submit')).toBeDisabled();
    await sheet.getByRole('textbox', { name: /^Base Price/ }).fill('120000');
    await expect(sheet.getByRole('button', 'Submit')).toBeEnabled();
  });

  test('MER-94 the Markup box and the Base Price box answer each other', { tags: TAGS }, async ({ app, screen }) => {
    const read = await readLine();
    await open(app, screen, read);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', 'Markup').fill('150');
    await expect(sheet.getByRole('textbox', { name: /^Base Price/ })).toHaveValue('100.000');
  });

  test('MER-95 without a name the article cannot be created', { tags: TAGS }, async ({ app, screen }) => {
    const read = await readLine();
    await open(app, screen, read);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('combobox', { name: /^Name/ }).fill('');
    await expect(sheet.getByRole('button', 'Submit')).toBeDisabled();
  });

  test('MER-96 emptying a quantity box leaves the grid short, and Submit says no', { tags: TAGS }, async ({ app, screen }) => {
    const read = await readLine();
    await open(app, screen, read);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', { name: /Black M pieces$/ }).fill('0');
    await expect(sheet).toContainText('6 of 8');
    await expect(sheet.getByRole('button', 'Submit')).toBeDisabled();
    await sheet.getByRole('textbox', { name: /Black M pieces$/ }).fill('2');
    await expect(sheet.getByRole('button', 'Submit')).toBeEnabled();
  });

  test('MER-97 Split Article is not offered on the sheet (hidden by the owner, 6 Oct)', { tags: TAGS }, async ({ app, screen }) => {
    const read = await readLine();
    await open(app, screen, read);
    await expect(screen.getByRole('dialog').getByRole('button', 'Split Article')).toHaveCount(0);
  });

  test('MER-98 nothing on the sheet matches the line to an article that already exists', { tags: TAGS }, async ({ app, screen }) => {
    const read = await readLine();
    await open(app, screen, read);
    const sheet = screen.getByRole('dialog');
    for (const word of ['Existing article', 'Add to existing', 'Attach to']) {
      await expect(sheet.getByText(word, { exact: false })).toHaveCount(0);
    }
  });

  test('MER-99 Submit mints the article with 4 SKUs, a new code, and the line leaves the queue', { tags: TAGS }, async ({ app, screen }) => {
    const line = await waiting(await ownStock(8, tag('NS')));
    const before = Math.max(...((await cloudCall('GET', '/api/v1/articles?limit=1')).body.items ?? []).map((a: any) => Number(a.article_code)), 0); // newest first
    await open(app, screen, line);
    await screen.getByRole('dialog').getByRole('button', 'Submit').tap();
    await expect(screen.getByText(/Setup saved · \d{8}/)).toBeVisible({ timeout: 90_000 });
    const made = await waitFor(`article ${line.name}`, async () => {
      const page = await cloudCall('GET', `/api/v1/articles?limit=20&q=${encodeURIComponent(line.name)}`);
      return (page.body?.items ?? []).find((a: any) => a.name.toLowerCase() === line.name.toLowerCase() && a.sku_count === 4);
    }, 120_000, 3_000);
    const detail = await articleDetail(made.article_code);
    expect(Number(detail.article_code)).toBeGreaterThan(before);
    expect(detail.division_code).toBe('PRIA');
    expect(detail.tags).toEqual(['KAOS']);
    expect(detail.base_price_min_minor).toBe(99_000);
    expect(detail.colours.map((c: any) => c.colour_code).sort()).toEqual(['BLACK', 'WHITE']);
    expect([...detail.size_codes].sort()).toEqual(['03', '04']);
    expect(detail.created_by_session_id).toBeTruthy();
    expect(await stillWaiting(line.row.receipt_line_id)).toBe(false);
  });

  test('MER-100 a delivery line cannot be set up a second time', { tags: [...TAGS, 'api'] }, async () => {
    const done = await splitArticle();
    const again = await cloudCall('POST', '/api/v1/article-setups', setupBody({ stock: done.stock, row: { receipt_line_id: done.receiptLineId }, name: `${done.name} dua` }));
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  test('MER-101 a session cannot create stock that did not arrive', { tags: [...TAGS, 'api'] }, async () => {
    const read = await readLine();
    const over = await cloudCall('POST', '/api/v1/article-setups', setupBody(read, { variants: [{ colour_digit: '1', size_code: '03', quantity: 80, base_price_minor: 99_000 }] }));
    expect(over.status).toBeGreaterThanOrEqual(400);
    expect(await stillWaiting(read.row.receipt_line_id)).toBe(true);
  });

  test('MER-102 a line split into two sibling articles gives two codes, one name, 2 SKUs each', { tags: [...TAGS, 'api'] }, async () => {
    const split = await splitArticle();
    expect(split.codes.length).toBe(2);
    expect(split.codes[0]).not.toBe(split.codes[1]);
    const [a, b] = [await articleDetail(split.codes[0]!), await articleDetail(split.codes[1]!)];
    expect(a.name).toBe(b.name);
    expect(a.sku_count).toBe(2);
    expect(b.sku_count).toBe(2);
    expect([a.colours[0].colour_code, b.colours[0].colour_code].sort()).toEqual(['BLACK', 'WHITE']);
    expect(a.division_code).toBe(b.division_code);
  });

  test('MER-103 both sibling articles are separate rows in the article master', { tags: TAGS }, async ({ app, screen }) => {
    const split = await splitArticle();
    await app.open('/master');
    await screen.getByRole('textbox', 'Search Articles').fill(split.name);
    await expect(screen.getByRole('row').filter({ hasText: split.name })).toHaveCount(2, { timeout: 90_000 });
    await expect(screen.getByText('articles match', { exact: false })).toBeVisible();
  });

  test('MER-104 the article sheet\'s Created By link opens the finished session in New Articles', { tags: TAGS }, async ({ app, screen, browser }) => {
    const split = await splitArticle();
    await app.open(`/master?article=${split.codes[0]}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('button', 'Edit')).toBeVisible(SLOW);
    const sessionId = (await articleDetail(split.codes[0]!)).created_by_session_id as string;
    await sheet.getByRole('link', sessionId).tap();
    await expect(browser).toHaveURL(/\/master\/new-articles\?.*setup=/);
    await expect(screen.getByRole('dialog')).toContainText(split.codes[0]!, SLOW);
  });

  test('MER-105 Request Quantity Check asks Ops to count the delivery, and the button turns to Requested', { tags: TAGS }, async ({ app, screen }) => {
    const line = await checkLine();
    await open(app, screen, line);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('button', 'Request Quantity Check').tap();
    await expect(sheet.getByRole('button', 'Requested')).toBeDisabled(SLOW);
    const asked = await checksOf(line);
    expect(asked.length).toBe(1);
    expect(asked[0].status).toBe('REQUESTED');
    expect(asked[0].po_number).toBe(line.stock.poNumber);
    // Ops sees it on its Quantity Checks list
    await app.open('/operations/quantity-checks');
    await expect(screen.getByRole('heading', 'Quantity Checks')).toBeVisible(SLOW);
    await expect(screen.getByText(line.stock.poNumber, { exact: false }).first()).toBeVisible({ timeout: 60_000 });
  });

  test('MER-106 once Ops has counted, the sheet shows colour, size and quantity and offers Recount', { tags: TAGS }, async ({ app, screen }) => {
    const line = await askedLine();
    if (!(await checksOf(line)).some((c) => c.status === 'REQUESTED')) {
      await cloudCall('POST', '/api/v1/quantity-checks', { receipt_line_id: line.row.receipt_line_id, article_name: line.name });
    }
    const open1 = (await checksOf(line)).find((c) => c.status === 'REQUESTED')!;
    const counted = await cloudCall('POST', `/api/v1/quantity-checks/${open1.check_id}/count`, {
      lines: [{ colour: 'Black', size: 'M', quantity: 5 }, { colour: 'White', size: 'L', quantity: 3 }],
    }, { who: 'nina' });
    expect(counted.status).toBeLessThan(300);
    await open(app, screen, line);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Black · M', SLOW);
    await expect(sheet).toContainText('White · L');
    await expect(sheet).toContainText('Counted by nina');
    await expect(sheet.getByRole('button', 'Recount')).toBeVisible();
  });

  test('MER-107 typing a name offers the Name Suggestions, and picking one fills the box', { tags: TAGS }, async ({ app, screen }) => {
    const read = await readLine();
    const suggestion = `Kaos Saran ${tag('G')}`;
    const made = await createNameApi(suggestion);
    try {
      await open(app, screen, read);
      const box = screen.getByRole('combobox', { name: /^Name/ });
      await box.fill('');
      await box.fill(suggestion.slice(0, 14));
      await expect(screen.getByRole('option', suggestion, { exact: false })).toBeVisible(SLOW);
      await screen.getByRole('option', suggestion, { exact: false }).tap();
      await expect(box).toHaveValue(new RegExp(suggestion, 'i'));
    } finally {
      await deleteNameApi(made.suggestion_id);
    }
  });
});
