// Master › Articles (screens/master/articles.tsx, detail.tsx, form.tsx): the article master, its sheet and its edit form.
// One article of this run's own (2 colours x 2 sizes, Rp 99.000, made through New Articles) carries every edit.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  articleByName, articleDetail, openList, patchArticle, rupiah, SLOW, sharedArticle, tag, unitsBook, type NewArticle,
} from '../../support/merchandise.ts';

const TAGS = ['merchandise', 'articles'];
const rowOf = (screen: any, text: string) => screen.getByRole('row').filter({ hasText: text });
const SEEDED = { code: '00000009', name: 'Sneakers Kanvas Low' };

let mine: NewArticle;

/** The run's shared article (built by the first test that needs it), with its current name read back. */
async function use() {
  const a = await sharedArticle();
  // The article outlives a run (it takes a PO to make) and earlier tests edit it: every test starts from the same record.
  const reset = await patchArticle(a.code, {
    name: a.stock.article,
    tags: ['KAOS'],
    active: true,
    units: [],
    purchase_unit_code: null,
    sales_unit_code: null,
  });
  expect(reset.status, JSON.stringify(reset.body)).toBeLessThan(300);
  mine = { ...a, name: a.stock.article };
}

/** Open the article's sheet by its deep link and wait for the Edit button. */
async function openSheet(app: any, screen: any, code: string, path = '/master') {
  await app.open(`${path}?article=${code}`);
  await expect(screen.getByRole('dialog').getByRole('button', 'Edit')).toBeVisible(SLOW);
}

async function startEdit(app: any, screen: any, code: string) {
  await openSheet(app, screen, code);
  await screen.getByRole('dialog').getByRole('button', 'Edit').tap();
  await expect(screen.getByRole('dialog').getByRole('button', 'Submit')).toBeVisible(SLOW);
}

describe('Master articles', { session: 'rina', tags: TAGS, timeout: 700_000 }, () => {
  test('MER-70 the article list shows KPIs and this run\'s article with its facts', { tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await use();
    await openList(app, screen, '/master', 'Articles');
    for (const kpi of ['Divisions', 'Colors', 'Sizes']) await expect(screen.getByText(kpi, { exact: true }).first()).toBeVisible(SLOW);
    await screen.getByRole('textbox', 'Search Articles').fill(mine.name);
    const row = rowOf(screen, mine.name);
    await expect(row).toContainText(mine.code, SLOW);
    await expect(row).toContainText('Pria');
    await expect(row).toContainText('M–L');
    await expect(row).toContainText(rupiah(99_000));
    await expect(row).toContainText('Active');
    await expect(screen.getByText('article matches', { exact: false })).toBeVisible();
  });

  test('MER-71 search finds an article by its code and says so when nothing matches', { tags: TAGS }, async ({ app, screen }) => {
    await use();
    await openList(app, screen, '/master', 'Articles');
    await screen.getByRole('textbox', 'Search Articles').fill(mine.code);
    await expect(rowOf(screen, mine.name)).toBeVisible(SLOW);
    await screen.getByRole('textbox', 'Search Articles').fill(`zzz-${tag('Q')}`);
    await expect(screen.getByText('No article matches that. Widen the filters, or search the whole master.')).toBeVisible(SLOW);
  });

  test('MER-72 the Division facet narrows the master to one division', { tags: TAGS }, async ({ app, screen }) => {
    await use();
    await openList(app, screen, '/master', 'Articles');
    await screen.getByRole('textbox', 'Search Articles').fill(mine.name);
    await expect(rowOf(screen, mine.name)).toBeVisible({ timeout: 90_000 });
    await screen.getByRole('combobox', 'Division').fill('Pria');
    await screen.getByRole('option', /^Pria/).first().tap();
    await expect(rowOf(screen, mine.name)).toBeVisible(SLOW);
    // with Pria on, a Tas article does not match even when searched for by name
    await screen.getByRole('textbox', 'Search Articles').fill('Tas Selempang');
    await expect(screen.getByText('No article matches that. Widen the filters, or search the whole master.')).toBeVisible(SLOW);
  });

  test('MER-73 Order flips the whole master to oldest first', { tags: TAGS }, async ({ app, screen, browser }) => {
    await use();
    await openList(app, screen, '/master', 'Articles');
    await screen.getByRole('button', 'Newest first').tap();
    await screen.getByText('Oldest first', { exact: true }).tap();
    await expect(screen.getByRole('button', 'Oldest first')).toBeVisible();
    await expect(browser).toHaveURL(/articleOrder=oldest/);
  });

  test('MER-74 the article sheet reads Overview facts, units and its way back to New Articles', { tags: TAGS }, async ({ app, screen }) => {
    await use();
    await openSheet(app, screen, mine.code);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText(mine.name);
    await expect(sheet).toContainText(mine.code);
    await expect(sheet.getByText('Colorways')).toBeVisible();
    await expect(sheet).toContainText('2 of 10');
    await expect(sheet).toContainText('IDR');
    await expect(sheet).toContainText('PCS (stock unit)');
    await expect(sheet).toContainText('Only ever counted in PCS.');
    await expect(sheet.getByRole('tab', 'SKUs (4)')).toBeVisible();
    await expect(sheet.getByRole('link', mine.sessionIds[0]!)).toBeVisible();
  });

  test('MER-75 the SKUs tab lays out colour by size', { tags: TAGS }, async ({ app, screen }) => {
    await use();
    await openSheet(app, screen, mine.code);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('tab', 'SKUs (4)').tap();
    await expect(sheet).toContainText('Black');
    await expect(sheet).toContainText('White');
    await expect(sheet).toContainText('M');
    await expect(sheet).toContainText('L');
    const detail = await articleDetail(mine.code);
    expect(detail.skus.length).toBe(4);
  });

  test('MER-76 the Suppliers tab lists who sells it, from the API\'s supplier items', { tags: TAGS }, async ({ app, screen }) => {
    await use();
    const detail = await articleDetail(mine.code);
    await openSheet(app, screen, mine.code);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('tab', `Suppliers (${detail.supplier_items.length})`).tap();
    if (detail.supplier_items.length === 0) await expect(sheet).toContainText('Supplier');
    else await expect(sheet).toContainText('Unit Price');
  });

  test('MER-77 Edit renames the article and the list shows the new name', { tags: TAGS }, async ({ app, screen }) => {
    await use();
    await startEdit(app, screen, mine.code);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText(mine.code);
    const renamed = `${mine.name} Baru`;
    await sheet.getByRole('textbox', { name: /^Name/ }).fill(renamed);
    await sheet.getByRole('button', 'Submit').tap();
    await expect(sheet.getByRole('button', 'Edit')).toBeVisible(SLOW);
    expect((await articleDetail(mine.code)).name).toBe(renamed);
    await openList(app, screen, '/master', 'Articles');
    await screen.getByRole('textbox', 'Search Articles').fill(renamed);
    await expect(rowOf(screen, renamed)).toBeVisible(SLOW);
    mine = { ...mine, name: renamed };
  });

  test('MER-78 Edit can add a tag and the sheet reads it back', { tags: TAGS }, async ({ app, screen }) => {
    await use();
    const before = (await articleDetail(mine.code)).tags as string[];
    await startEdit(app, screen, mine.code);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('button', 'Basic').tap();
    await expect(sheet.getByRole('button', 'Basic')).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByRole('button', 'Submit').tap();
    await expect(sheet.getByRole('button', 'Edit')).toBeVisible(SLOW);
    const after = (await articleDetail(mine.code)).tags as string[];
    expect(after).toContain('BASIC');
    expect(after.length).toBe(before.length + 1);
  });

  test('MER-79 per-article units: another unit worth 6 pieces, and it becomes the default purchase unit', { tags: TAGS }, async ({ app, screen }) => {
    await use();
    await startEdit(app, screen, mine.code);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('button', 'Add a unit').tap();
    await sheet.getByRole('textbox', { name: /^Stock units in one/ }).fill('6');
    const label = ((await sheet.getByRole('combobox', 'Unit').textContent()) ?? '').trim();
    expect(label).toBeTruthy();
    await sheet.getByRole('combobox', 'Default purchase unit').tap();
    await screen.getByRole('option', label, { exact: true }).tap();
    await sheet.getByRole('button', 'Submit').tap();
    await expect(sheet.getByRole('button', 'Edit')).toBeVisible(SLOW);
    const detail = await articleDetail(mine.code);
    expect(detail.units.length).toBe(1);
    expect(detail.units[0].factor).toBe('6');
    expect(detail.purchase_unit_code).toBe(detail.units[0].unit_code);
    expect(detail.sales_unit_code).toBeNull();
    await expect(sheet).toContainText(`1 ${detail.units[0].unit_code} = 6 PCS`);
  });

  test('MER-80 the stock unit can only be a whole-number unit', { tags: TAGS }, async ({ app, screen }) => {
    await use();
    const book = await unitsBook();
    const fractional = book.units.find((u) => !u.whole_number && u.active);
    expect(fractional).toBeDefined();
    await startEdit(app, screen, mine.code);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('combobox', { name: /^Stock unit/ }).tap();
    await expect(screen.getByRole('option', 'Piece')).toBeVisible();
    await expect(screen.getByRole('option', fractional!.label, { exact: true })).toHaveCount(0);
  });

  test('MER-81 Sold: Cancelled takes the article off sale; the list shows Cancelled', { tags: TAGS }, async ({ app, screen }) => {
    await use();
    await startEdit(app, screen, mine.code);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('button', 'Cancelled').tap();
    await sheet.getByRole('button', 'Submit').tap();
    await expect(sheet.getByRole('button', 'Edit')).toBeVisible(SLOW);
    expect((await articleDetail(mine.code)).active).toBe(false);
    await expect(sheet).toContainText('Cancelled');
    // and back, so the article is usable by the next tests
    await sheet.getByRole('button', 'Edit').tap();
    await sheet.getByRole('button', 'Active').tap();
    await sheet.getByRole('button', 'Submit').tap();
    await expect(sheet.getByRole('button', 'Edit')).toBeVisible(SLOW);
    expect((await articleDetail(mine.code)).active).toBe(true);
  });

  test('MER-82 Stop editing leaves the record unchanged', { tags: TAGS }, async ({ app, screen }) => {
    await use();
    await startEdit(app, screen, mine.code);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', { name: /^Name/ }).fill('Tidak jadi disimpan');
    await sheet.getByRole('button', 'Cancel').tap();
    await expect(sheet.getByRole('button', 'Edit')).toBeVisible();
    expect((await articleDetail(mine.code)).name).toBe(mine.name);
  });

  test('MER-83 an edit made after the sheet opened is refused as stale, nothing saved', { tags: TAGS }, async ({ app, screen }) => {
    await use();
    await startEdit(app, screen, mine.code);
    const sheet = screen.getByRole('dialog');
    const bump = await patchArticle(mine.code, { name: mine.name });
    expect(bump.status, JSON.stringify(bump.body)).toBeLessThan(300);
    await sheet.getByRole('textbox', { name: /^Name/ }).fill(`${mine.name} Stale`);
    await sheet.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('Somebody else changed this article after you opened it', { exact: false })).toBeVisible(SLOW);
    await expect(sheet.getByRole('button', 'Discard my changes and read theirs')).toBeVisible();
    expect((await articleDetail(mine.code)).name).toBe(mine.name);
  });

  test('MER-84 the same article opens from Merchandise › Articles', { tags: TAGS }, async ({ app, screen }) => {
    await use();
    await openSheet(app, screen, mine.code, '/merchandise');
    await expect(screen.getByRole('dialog')).toContainText(mine.name);
  });

  test('MER-85 a seeded article (Sneakers Kanvas Low) reads its facts in the sheet', { tags: TAGS }, async ({ app, screen }) => {
    await openSheet(app, screen, SEEDED.code);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText(SEEDED.name);
    await expect(sheet).toContainText('Sandal dan Sepatu');
    await expect(sheet.getByRole('tab', /^SKUs \(\d+\)$/)).toBeVisible();
    expect(await articleByName(SEEDED.name)).toBeDefined();
  });
});
