// Merchandise › Allotments (/allotment): the five tabs, the Unallotted picker, the Allotted book and its readings.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as } from '../../support/rig.ts';
import { allot, allotmentByNumber, allotmentDetail, DC_SITE, freeOf, freshStock, openAllotments, ownStock, pick, SOURCE_POOL, waitAccepted, waitToPick } from '../../support/outbound.ts';

describe('Allotments list', { tags: ['outbound'] }, () => {
  test('OUT-01 the page names its five tabs and the four figures', { session: 'rina', tags: ['outbound', 'smoke'] }, async ({ app, screen }) => {
    await openAllotments(app, screen);
    for (const tab of [/^Unallotted/, /^Allotted/, /^Overdue/, /^Still needed/, /^Closed short/]) await expect(screen.getByRole('tab', tab)).toBeVisible();
    for (const kpi of ['Active', 'Completed', 'Not shipped yet', 'In transit']) await expect(screen.getByText(kpi, { exact: true }).first()).toBeVisible();
  });

  test('OUT-02 Unallotted lists my article under its supplier; ticking it offers Make new allotment', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen, browser }) => {
    const s = await freshStock(8);
    await openAllotments(app, screen);
    await expect(screen.getByRole('tab', /^Unallotted/)).toHaveAttribute('aria-selected', 'true');
    await screen.getByRole('textbox', 'Search supplier, article or order').fill(s.article);
    const tick = screen.getByRole('checkbox', `Select ${s.article}`);
    await expect(tick).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText('Garmen Nusantara, PT').first()).toBeVisible();
    await expect(screen.getByRole('button', 'Make new allotment')).toBeHidden();
    await tick.check();
    await expect(screen.getByText('1 article · 1 supplier · 8 pcs selected')).toBeVisible();
    await expect(screen.getByRole('button', 'Make new allotment')).toBeEnabled();
    await screen.getByRole('button', 'Clear').tap();
    await expect(screen.getByRole('button', 'Make new allotment')).toBeHidden();
    await tick.check();
    await screen.getByRole('button', 'Make new allotment').tap();
    await expect(browser).toHaveURL(/\/allotment\/new\?/);
    await expect(screen.getByRole('heading', 'New allotment · Garmen Nusantara, PT')).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText('1 article · 8 pcs to allot')).toBeVisible({ timeout: 30_000 });
  });

  test('OUT-03 the Unallotted search narrows to what it names and says so when nothing matches', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await ownStock('list', 80);
    await openAllotments(app, screen);
    const search = screen.getByRole('textbox', 'Search supplier, article or order');
    await search.fill(s.article);
    await expect(screen.getByRole('checkbox', `Select ${s.article}`)).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByRole('checkbox', 'Select Blus Rayon Motif Bunga')).toBeHidden();
    await search.fill('zzzz-tidak-ada');
    await expect(screen.getByText('No supplier, article or order matches “zzzz-tidak-ada”.')).toBeVisible();
  });

  test('OUT-04 an allotment made for two stores shows in the Allotted tab by number, with its stores and quantity', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await ownStock('list', 80);
    const made = await allot([{ sku: s.skus[0], store: 'store-02', qty: 3 }, { sku: s.skus[1], store: 'store-03', qty: 2 }], `Uji daftar ${s.t}`);
    await openAllotments(app, screen);
    await screen.getByRole('tab', /^Allotted/).tap();
    await screen.getByRole('textbox', 'Search allotments').fill(made.allotment_number);
    const row = screen.getByRole('row', new RegExp(made.allotment_number));
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row).toContainText('5');
    const book = await allotmentByNumber(made.allotment_number);
    expect(book?.total_quantity).toBe(5);
    expect(book?.destination_count).toBe(2);
  });

  test('OUT-05 a fresh allotment is not Overdue and not Still needed', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await ownStock('list', 80);
    const made = await allot([{ sku: s.skus[2], store: 'store-04', qty: 2 }], `Uji overdue ${s.t}`);
    await openAllotments(app, screen);
    await screen.getByRole('tab', /^Overdue/).tap();
    await expect(screen.getByText(made.allotment_number)).toBeHidden();
    await screen.getByRole('tab', /^Still needed/).tap();
    await expect(screen.getByText(made.allotment_number)).toBeHidden();
  });

  test('OUT-06 the By store reading lists what one store is owed', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await ownStock('list', 80);
    const made = await allot([{ sku: s.skus[3], store: 'store-05', qty: 2 }], `Uji per toko ${s.t}`);
    await openAllotments(app, screen);
    await screen.getByRole('tab', /^Allotted/).tap();
    await screen.getByRole('combobox', 'Reading').tap();
    await screen.getByRole('option', 'By store').tap();
    await expect(screen.getByText('Choose a store to see everything owed to it, and its lifetime per-SKU pipeline.')).toBeVisible();
    await screen.getByRole('combobox').last().tap();
    await screen.getByRole('option', 'Store 05').tap();
    await expect(screen.getByRole('row', new RegExp(made.allotment_number))).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText(/This summary spans every allotment ever addressed to/)).toBeVisible();
  });

  test('OUT-102 the By article reading rolls the book up by garment, for every store or for one', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await ownStock('list', 80);
    await allot([{ sku: s.skus[0], store: 'store-06', qty: 2 }, { sku: s.skus[1], store: 'store-07', qty: 1 }], `Uji per artikel ${s.t}`);
    await openAllotments(app, screen);
    await screen.getByRole('tab', /^Allotted/).tap();
    await screen.getByRole('combobox', 'Reading').tap();
    await screen.getByRole('option', 'By article').tap();
    await expect(screen.getByText('Every article ever allotted')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('textbox', 'Search allotments').fill(s.article);
    await expect(screen.getByRole('row', new RegExp(s.article))).toBeVisible({ timeout: 45_000 });
    await screen.getByRole('combobox').last().tap();
    await screen.getByRole('option', 'Store 06').tap();
    await expect(screen.getByText('Sent to Store 06')).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByRole('row', new RegExp(s.article))).toBeVisible();
  });

  test('OUT-07 a remainder MD closed short moves to the Closed short tab', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await ownStock('list', 80);
    const made = await allot([{ sku: s.skus[0], store: 'store-02', qty: 4 }], `Uji closed short ${s.t}`);
    await waitAccepted(made.id);
    const [p] = await waitToPick(made.allotment_number);
    await pick(p, { [s.skus[0].sku_code]: 3 });
    const line = (await allotmentDetail(made.id)).lines[0];
    await as('cloud', 'rina').post(`/api/v1/inventory/allotments/${made.id}/close-short`, { idempotency_key: crypto.randomUUID(), lines: [{ allotment_line_id: line.id, quantity: 1 }], reason: null });
    await openAllotments(app, screen);
    await screen.getByRole('tab', /^Closed short/).tap();
    const row = screen.getByRole('row', new RegExp(made.allotment_number));
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row).toContainText('Store 02');
    await expect(row).toContainText(s.skus[0].sku_code);
    await screen.getByRole('tab', /^Still needed/).tap();
    await expect(screen.getByText(made.allotment_number)).toBeHidden();
  });

  test('OUT-08 the server refuses to promise more than the pool holds free', { tags: ['outbound', 'api'], timeout: 420_000 }, async () => {
    const s = await ownStock('list', 80);
    const free = await freeOf(s.skus[1]);
    const res = await as('cloud', 'rina').call('POST', '/api/v1/inventory/allotments', {
      type: 'TO_STORE', notes: 'Uji terlalu banyak', actor_id: 'rina', idempotency_key: crypto.randomUUID(),
      lines: [{ source_site_id: DC_SITE, source_pool_id: SOURCE_POOL, destination_type: 'STORE', destination_id: 'store-03', sku_id: s.skus[1].sku_id, quantity: free + 1 }],
    }, { ok: false });
    expect(res.allotment_number).toBeUndefined();
    expect(JSON.stringify(res)).toMatch(/error|insufficient|exceed|free|available/i);
    expect(await freeOf(s.skus[1])).toBe(free);
  });

  test('OUT-09 sending the same allotment twice (same idempotency key) raises it once', { tags: ['outbound', 'api'], timeout: 420_000 }, async () => {
    const s = await ownStock('list', 80);
    const free = await freeOf(s.skus[2]);
    const body = {
      type: 'TO_STORE', notes: 'Uji dua kali', actor_id: 'rina', idempotency_key: crypto.randomUUID(),
      lines: [{ source_site_id: DC_SITE, source_pool_id: SOURCE_POOL, destination_type: 'STORE', destination_id: 'store-03', sku_id: s.skus[2].sku_id, quantity: 2 }],
    };
    const first = await as('cloud', 'rina').post('/api/v1/inventory/allotments', body);
    const second = await as('cloud', 'rina').post('/api/v1/inventory/allotments', body);
    expect(second.id).toBe(first.id);
    expect(second.allotment_number).toBe(first.allotment_number);
    expect(await freeOf(s.skus[2])).toBe(free - 2);
  });
});
