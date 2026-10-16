// Ops › Picking: one picklist per allotment × shop, accepted from the board card or the Picking page.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, rows, waitFor } from '../../support/rig.ts';
import { allot, CLOUD_DC, ownStock, packRemaining, ship, toPick, waitToPick } from '../../support/outbound.ts';

const REASONS = ['Stock at rack could not be confirmed', 'Item not found at the rack', 'Item damaged', 'Label or equipment problem', 'Other'];

describe('Ops › Picking', { tags: ['outbound'] }, () => {
  test('OUT-40 an allotment to three stores gives three picklists, one per shop; accepting one leaves the others waiting', { session: 'nina', tags: ['outbound', 'smoke'], timeout: 480_000 }, async ({ app, screen }) => {
    const s = await ownStock('pick', 80);
    const made = await allot([
      { sku: s.skus[0], store: 'store-03', qty: 2 }, { sku: s.skus[1], store: 'store-03', qty: 1 },
      { sku: s.skus[0], store: 'store-04', qty: 3 }, { sku: s.skus[2], store: 'store-05', qty: 2 },
    ], `Uji pick ${s.t}`);
    const waiting = await waitToPick(made.allotment_number, 3);
    expect(waiting.map((p) => p.destination_id).sort()).toEqual(['store-03', 'store-04', 'store-05']);
    expect(waiting.map((p) => p.pieces).sort()).toEqual([2, 3, 3]);

    await app.open('/operations/board');
    const lane = screen.getByRole('region', /^Pick List/);
    const cards = lane.getByRole('button', new RegExp(made.allotment_number));
    await expect(cards).toHaveCount(3, { timeout: 60_000 });
    const card = cards.filter({ hasText: 'C004 · Bumiayu' });
    await expect(card).toContainText('1 SKU');
    await expect(card).toContainText('3 pcs');
    await card.tap();

    const sheet = screen.getByRole('dialog', 'Picklist');
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    await expect(sheet).toContainText('C004 · Bumiayu');
    await expect(sheet).toContainText(made.allotment_number);
    await expect(sheet).toContainText(s.skus[0].sku_code);
    await expect(sheet.getByRole('textbox', 'Picked')).toHaveValue('3');
    await sheet.getByRole('button', 'Submit').tap();
    // accepting opens the picklist it made: Completed, 3 picked, 3 to pack
    const round = screen.getByRole('dialog', 'Picklist');
    await expect(round).toContainText('Completed', { timeout: 45_000 });
    await expect(round).toContainText('C004 · Bumiayu');
    await expect(round).toContainText(made.allotment_number);
    await expect(round.getByRole('row', new RegExp(s.skus[0].sku_code))).toContainText('3');
    await expect(round.getByRole('link', 'Pack')).toBeVisible();

    // the other two shops are still waiting; this one moved to Picked
    const left = (await toPick()).filter((p) => p.allotment_number === made.allotment_number);
    expect(left.map((p) => p.destination_id).sort()).toEqual(['store-03', 'store-05']);
    const rounds = rows(await as('dc', 'nina').get('/api/v1/dc/picklists'));
    const mine = rounds.find((r) => r.allotment_number === made.allotment_number && r.destination_id === 'store-04');
    expect(mine?.total_picked).toBe(3);
    expect(mine?.waiting).toBe(3);
    await app.open('/operations/board');
    await expect(screen.getByRole('region', /^Picked/).getByRole('button', /C004 · Bumiayu/)).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByRole('region', /^Pick List/).getByRole('button', new RegExp(made.allotment_number))).toHaveCount(2, { timeout: 45_000 });
    await ship(await packRemaining('store-04'));
  });

  test('OUT-41 the Picking page lists the picklists to pick by shop and the picklists already accepted', { session: 'nina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen, browser }) => {
    const s = await ownStock('pick', 80);
    const made = await allot([{ sku: s.skus[1], store: 'store-06', qty: 2 }, { sku: s.skus[2], store: 'store-07', qty: 2 }], `Uji picking page ${s.t}`);
    await waitToPick(made.allotment_number, 2);
    await app.open('/operations/picking');
    await expect(screen.getByRole('heading', 'Picking')).toBeVisible({ timeout: 60_000 });
    for (const k of ['Picklists to pick', 'Pcs to pick', 'Picked today', 'To pack']) await expect(screen.getByText(k, { exact: true })).toBeVisible();
    await expect(screen.getByText('To pick', { exact: true }).first()).toBeVisible();
    const row = screen.getByRole('button', new RegExp(made.allotment_number)).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.tap();
    const sheet = screen.getByRole('dialog', 'Picklist');
    await sheet.getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('dialog', 'Picklist')).toContainText('Completed', { timeout: 45_000 });
    await browser.keyboard.press('Escape');
    await expect(screen.getByRole('row', new RegExp(made.allotment_number)).first()).toContainText('Completed', { timeout: 45_000 });
    await ship(await packRemaining('store-06'));
  });

  test('OUT-42 picking fewer than asked asks why; Submit stays shut until a reason is chosen', { session: 'nina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    const s = await ownStock('pick', 80);
    const made = await allot([{ sku: s.skus[0], store: 'store-08', qty: 4 }], `Uji short ${s.t}`);
    await waitToPick(made.allotment_number);
    await app.open(`/operations/board`);
    await screen.getByRole('region', /^Pick List/).getByRole('button', new RegExp(made.allotment_number)).tap();
    const sheet = screen.getByRole('dialog', 'Picklist');
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    await expect(sheet.getByText('Why?')).toBeHidden();
    await sheet.getByRole('button', 'One less').tap();
    await expect(sheet.getByRole('textbox', 'Picked')).toHaveValue('3');
    await expect(sheet.getByRole('status')).toContainText('1 pc short');
    await expect(sheet.getByRole('status')).toContainText('choose why');
    for (const r of REASONS) await expect(sheet.getByRole('button', r)).toBeVisible();
    await expect(sheet.getByRole('button', 'Submit')).toBeDisabled();
    await sheet.getByRole('button', 'Other').tap();
    await expect(sheet.getByRole('button', 'Submit')).toBeEnabled();
    // Picked cannot go above what was asked
    await sheet.getByRole('textbox', 'Picked').fill('9');
    await expect(sheet.getByRole('textbox', 'Picked')).toHaveValue('4');
  });

  test('OUT-43 a short pick books what was picked and leaves the shortfall on the same picklist', { session: 'nina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    const s = await ownStock('pick', 80);
    const made = await allot([{ sku: s.skus[1], store: 'store-09', qty: 4 }], `Uji short pick ${s.t}`);
    await waitToPick(made.allotment_number);
    await app.open('/operations/board');
    await screen.getByRole('region', /^Pick List/).getByRole('button', new RegExp(made.allotment_number)).tap();
    const sheet = screen.getByRole('dialog', 'Picklist');
    await sheet.getByRole('button', 'One less').tap();
    await sheet.getByRole('button', 'Other').tap();
    await sheet.getByRole('button', 'Submit').tap();
    // what the picker did get is in, whatever happens to the report
    const rounds = await waitFor('the short picklist', async () => rows(await as('dc', 'nina').get('/api/v1/dc/picklists')).find((r) => r.allotment_number === made.allotment_number), 45_000, 2_000);
    expect(rounds.total_picked).toBe(3);
    const left = (await toPick()).filter((p) => p.allotment_number === made.allotment_number);
    expect(left.length).toBe(1);
    expect(left[0].pieces).toBe(1);
    await ship(await packRemaining('store-09'));
  });

  test('OUT-44 a short pick report reaches MD: toast, Short pick flag on the card, Cannot-continue reasons (cloud-hosted DC only)', { session: 'nina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    test.skip(!CLOUD_DC, 'needs the cloud-hosted DC: POST /api/v1/dc/short-picks answers 404 on this rig\'s edge DC');
    const s = await ownStock('pick', 80);
    const made = await allot([{ sku: s.skus[2], store: 'store-10', qty: 4 }], `Uji short flag ${s.t}`);
    await waitToPick(made.allotment_number);
    await app.open('/operations/board');
    await screen.getByRole('region', /^Pick List/).getByRole('button', new RegExp(made.allotment_number)).tap();
    const sheet = screen.getByRole('dialog', 'Picklist');
    await sheet.getByRole('button', 'One less').tap();
    await sheet.getByRole('button', 'Label or equipment problem').tap();
    await sheet.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('Short pick reported · 1 pcs')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('region', /^Pick List/).getByRole('button', new RegExp(made.allotment_number))).toContainText('Short pick');
  });
});
