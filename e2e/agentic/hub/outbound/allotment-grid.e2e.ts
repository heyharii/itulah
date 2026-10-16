// New allotment (/allotment/new): the article × 16-store grid, its rules and its Submit.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, rows } from '../../support/rig.ts';
import { allotmentByNumber, allotmentDetail, cell, freeOf, freshStock, storeLabel, sum, type Stock } from '../../support/outbound.ts';

/** Open the grid on one article of Garmen Nusantara. */
async function openGrid(app: any, screen: any, s: Stock) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const av = rows(await as('cloud', 'rina').get('/api/v1/inventory/availability?limit=3000')).find((r) => r.sku_code === s.skus[0].sku_code);
  await app.open(`/allotment/new?supplier=0001&articles=${av.article_id}`);
  await expect(screen.getByRole('heading', 'New allotment · Garmen Nusantara, PT')).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByText(new RegExp(`1 article · ${s.perSku * 4} pcs to allot`))).toBeVisible({ timeout: 45_000 });
}

describe('New allotment grid', { tags: ['outbound'] }, () => {
  test('OUT-10 the grid has a column for each of the 16 stores and a row per SKU with its free stock', { session: 'rina', tags: ['outbound', 'smoke'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await freshStock(8);
    await openGrid(app, screen, s);
    for (let i = 1; i <= 16; i++) await expect(screen.getByText(`C${String(i).padStart(3, '0')}`, { exact: true })).toBeVisible();
    for (const sku of s.skus) {
      await expect(screen.getByText(sku.sku_code, { exact: true })).toBeVisible();
      await expect(cell(screen, sku.sku_code, storeLabel('store-01'))).toBeVisible();
      await expect(cell(screen, sku.sku_code, storeLabel('store-c016'))).toBeVisible();
    }
    await expect(screen.getByRole('button', 'Submit all')).toBeDisabled();
  });

  test('OUT-11 a cell cannot take more than the SKU has free', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await freshStock(8);
    await openGrid(app, screen, s);
    const box = cell(screen, s.skus[0].sku_code, storeLabel('store-01'));
    await box.fill('99');
    await expect(box).toHaveValue('2');
    await box.fill('abc');
    await expect(box).toHaveValue('');
    // the row shares one pile: 1 in the first store leaves 1 for the second
    await box.fill('1');
    const second = cell(screen, s.skus[0].sku_code, storeLabel('store-02'));
    await second.fill('9');
    await expect(second).toHaveValue('1');
  });

  test('OUT-12 giving only part of the article says how much is left and keeps Submit shut', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await freshStock(8);
    await openGrid(app, screen, s);
    await cell(screen, s.skus[0].sku_code, storeLabel('store-01')).fill('1');
    await expect(screen.getByText('Allot all 8 pieces — 7 left')).toBeVisible();
    await expect(screen.getByText('1 article still has stock left')).toBeVisible();
    await expect(screen.getByRole('button', 'Submit').first()).toBeDisabled();
    await expect(screen.getByRole('button', 'Submit all')).toBeDisabled();
  });

  test('OUT-13 spreading every piece over several stores and pressing Submit raises one allotment with a line per store', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await freshStock(8);
    await openGrid(app, screen, s);
    const plan: [number, string, string][] = [
      [0, 'store-01', '1'], [0, 'store-03', '1'],
      [1, 'store-02', '2'],
      [2, 'store-01', '1'], [2, 'store-04', '1'],
      [3, 'store-05', '2'],
    ];
    for (const [i, store, qty] of plan) await cell(screen, s.skus[i].sku_code, storeLabel(store)).fill(qty);
    await expect(screen.getByText('All 8 allotted')).toBeVisible();
    await expect(screen.getByText('1 ready — Submit on its row')).toBeVisible();
    const submit = screen.getByRole('button', 'Submit').first();
    await expect(submit).toBeEnabled();
    await submit.tap();
    const receipt = screen.getByText(/^Saved ALT-\d+ \(/);
    await expect(receipt).toBeVisible({ timeout: 60_000 });
    const number = (await receipt.textContent())!.match(/ALT-\d+/)![0];
    const book = await allotmentByNumber(number);
    expect(book?.total_quantity).toBe(8);
    expect(book?.destination_count).toBe(4 + 1);
    const detail = await allotmentDetail(book!.id);
    const byStore = (id: string) => sum(detail.lines.filter((l: any) => l.destination_id === id).map((l: any) => l.quantity)); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect([byStore('store-01'), byStore('store-02'), byStore('store-03'), byStore('store-04'), byStore('store-05')]).toEqual([2, 2, 1, 1, 2]);
    expect(await freeOf(s.skus[0])).toBe(0);
  });

  test('OUT-14 Back with typed quantities asks before discarding; without them it just goes back', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen, browser }) => {
    const s = await freshStock(8);
    await openGrid(app, screen, s);
    await cell(screen, s.skus[0].sku_code, storeLabel('store-01')).fill('1');
    await screen.getByRole('button', 'Back').tap();
    await expect(screen.getByText('Discard the typed quantities?')).toBeVisible();
    await expect(screen.getByText('Going back to the articles clears the quantities typed for this allotment.')).toBeVisible();
    await screen.getByRole('button', 'Cancel').tap();
    await expect(cell(screen, s.skus[0].sku_code, storeLabel('store-01'))).toHaveValue('1');
    await screen.getByRole('button', 'Back').tap();
    await screen.getByRole('button', 'Discard').tap();
    await expect(browser).toHaveURL(/\/allotment(\?|$)/);
    expect(await freeOf(s.skus[0])).toBe(2);
  });

  test('OUT-15 the wand fills an article: everything to one store', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await freshStock(16);
    await openGrid(app, screen, s);
    await screen.getByRole('button', `Fill ${s.article}`).tap();
    await screen.getByRole('button', 'Everything to one store…').tap();
    await screen.getByRole('textbox', 'Find a store').fill('Jambi');
    await expect(screen.getByRole('button', 'C016 · Cirebon')).toBeHidden();
    await screen.getByRole('button', 'C005 · Jambi').tap();
    await expect(screen.getByText('Filled 4 SKUs · 16 pcs')).toBeVisible({ timeout: 15_000 });
    for (const sku of s.skus) await expect(cell(screen, sku.sku_code, storeLabel('store-05'))).toHaveValue('4');
    await expect(screen.getByText('All 16 allotted')).toBeVisible();
  });

  test('OUT-100 the wand\'s Clear this article empties what it filled', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await freshStock(16);
    await openGrid(app, screen, s);
    await screen.getByRole('button', `Fill ${s.article}`).tap();
    await expect(screen.getByRole('button', 'Clear this article')).toBeDisabled();
    await screen.getByRole('button', /^Split evenly across all stores/).tap();
    await expect(screen.getByText(/^Filled 4 SKUs/)).toBeVisible({ timeout: 15_000 });
    await screen.getByRole('button', `Fill ${s.article}`).tap();
    await screen.getByRole('button', 'Clear this article').tap();
    await expect(screen.getByText('Cleared 16 pcs')).toBeVisible();
    await expect(cell(screen, s.skus[0].sku_code, storeLabel('store-01'))).toHaveValue('');
  });

  test('OUT-101 [bug] reopening the wand starts at its main menu, not in the sub-menu the last fill used', { session: 'rina', tags: ['outbound', 'bug'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await freshStock(16);
    await openGrid(app, screen, s);
    await screen.getByRole('button', `Fill ${s.article}`).tap();
    await screen.getByRole('button', 'Everything to one store…').tap();
    await screen.getByRole('button', 'C005 · Jambi').tap();
    await expect(screen.getByText(/^Filled 4 SKUs/)).toBeVisible({ timeout: 15_000 });
    await screen.getByRole('button', `Fill ${s.article}`).tap();
    await expect(screen.getByRole('button', 'Everything to one store…')).toBeVisible();
    await expect(screen.getByRole('button', 'Clear this article')).toBeVisible();
  });

  test('OUT-16 Split evenly across all stores gives every store a share and uses every piece', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await freshStock(16);
    await openGrid(app, screen, s);
    await screen.getByRole('button', `Fill ${s.article}`).tap();
    await screen.getByRole('button', /^Split evenly across all stores/).tap();
    await expect(screen.getByText(/^Filled 4 SKUs · 16 pcs/)).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByText('All 16 allotted')).toBeVisible();
    await expect(screen.getByRole('button', 'Submit').first()).toBeEnabled();
  });

  test('OUT-17 Clear empties the typed quantities and offers Undo', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await freshStock(8);
    await openGrid(app, screen, s);
    const box = cell(screen, s.skus[0].sku_code, storeLabel('store-01'));
    await box.fill('2');
    await screen.getByRole('button', 'Clear', { exact: true }).tap();
    await expect(box).toHaveValue('');
    await expect(screen.getByText('Cleared 2 pcs')).toBeVisible();
    await screen.getByRole('button', 'Undo').tap();
    await expect(box).toHaveValue('2');
  });

  test('OUT-18 Submit all & done raises the article and returns to the list', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen, browser }) => {
    const s = await freshStock(8);
    await openGrid(app, screen, s);
    for (const sku of s.skus) await cell(screen, sku.sku_code, storeLabel('store-06')).fill('2');
    await screen.getByRole('button', 'Submit all & done').tap();
    await expect(browser).toHaveURL(/\/allotment(\?|$)/, { timeout: 60_000 });
    await expect.poll(async () => await freeOf(s.skus[0]), { timeout: 30_000 }).toBe(0);
    const mine = rows(await as('cloud', 'rina').get('/api/v1/inventory/allotments?limit=500')).find((a) => a.destination_names?.includes('Store 06') && a.total_quantity === 8 && a.created_at > new Date(Date.now() - 300_000).toISOString());
    expect(mine).toBeTruthy();
  });

  test('OUT-19 the article row folds its SKUs away and brings them back', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await freshStock(8);
    await openGrid(app, screen, s);
    const head = screen.getByRole('button', new RegExp(s.article)).first();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    await head.tap();
    await expect(screen.getByText(s.skus[0].sku_code, { exact: true })).toBeHidden();
    await head.tap();
    await expect(screen.getByText(s.skus[0].sku_code, { exact: true })).toBeVisible();
  });
});
