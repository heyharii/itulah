// Ops › Allotment board (/operations/board): Pick List · Picked · Pack · Dispatch · Received, as lanes or as a table.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { allot, ownStock, pick, packRemaining, ship, toInTransit, toPacked, waitToPick } from '../../support/outbound.ts';

/** Four allotments, one per stage, each to a store of its own so the lanes can be told apart. */
async function fourStages() {
  const s = await ownStock('ops', 80);
  const a1 = await allot([{ sku: s.skus[0], store: 'store-11', qty: 2 }, { sku: s.skus[1], store: 'store-11', qty: 3 }], `Uji board pick ${s.t}`);
  await waitToPick(a1.allotment_number);
  const a2 = await allot([{ sku: s.skus[0], store: 'store-12', qty: 2 }], `Uji board picked ${s.t}`);
  const [p2] = await waitToPick(a2.allotment_number);
  await pick(p2);
  const packed = await toPacked([{ sku: s.skus[1], store: 'store-13', qty: 2 }], `Uji board pack ${s.t}`);
  const sent = await toInTransit([{ sku: s.skus[2], store: 'store-02', qty: 2 }], `Uji board dispatch ${s.t}`);
  return { s, a1, a2, packed, sent };
}

describe('Ops › Allotment board', { tags: ['outbound'] }, () => {
  test('OUT-30 each stage of the journey is a lane and my allotments sit in the lane they have reached', { session: 'nina', tags: ['outbound', 'smoke'], timeout: 480_000 }, async ({ app, screen }) => {
    const { a1, a2, packed, sent } = await fourStages();
    await app.open('/operations/board');
    await expect(screen.getByRole('heading', 'Allotment')).toBeVisible({ timeout: 60_000 });
    for (const lane of ['Pick List', 'Picked', 'Pack', 'Dispatch', 'Received']) await expect(screen.getByRole('region', new RegExp(`^${lane}`)).first()).toBeVisible({ timeout: 60_000 });
    const pickLane = screen.getByRole('region', /^Pick List/);
    const card1 = pickLane.getByRole('button', new RegExp(a1.allotment_number));
    await expect(card1).toBeVisible({ timeout: 60_000 });
    await expect(card1).toContainText('C011 · Sipin');
    await expect(card1).toContainText('2 SKUs');
    await expect(card1).toContainText('5 pcs');
    const pickedLane = screen.getByRole('region', /^Picked/);
    // one card per shop: it names the allotment only while that is the shop's single picked allotment
    const card2 = pickedLane.getByRole('button', /C012 · Banjaran/);
    await expect(card2).toContainText('C012 · Banjaran');
    await expect(card2).toContainText('pcs');
    const packLane = screen.getByRole('region', /^Pack/);
    const koli = packed.cartons[0].koli_number;
    const card3 = packLane.getByRole('button', new RegExp(koli));
    await expect(card3).toContainText('C013 · Wonosobo');
    const roadLane = screen.getByRole('region', /^Dispatch/);
    const card4 = roadLane.getByRole('button', new RegExp(`${sent.trip.dispatch.dispatch_number}.*`)).filter({ hasText: 'C002 · Muaro Bungo' });
    await expect(card4).toBeVisible();
    await expect(card4).toContainText('1 carton');
    await expect(card4).toContainText('2 pcs');
    await ship(await packRemaining('store-12'));
  });

  test('OUT-31 the Table view lists the same cards with their stage', { session: 'nina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen, browser }) => {
    const { a1, packed } = await fourStages();
    await ship(await packRemaining('store-12'));
    await app.open('/operations/board');
    await expect(screen.getByRole('button', 'Table')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('button', 'Table').tap();
    const row1 = screen.getByRole('row', new RegExp(a1.allotment_number));
    await expect(row1).toBeVisible({ timeout: 45_000 });
    await expect(row1).toContainText('Pick list');
    await expect(row1).toContainText('C011 · Sipin');
    await expect(row1).toContainText('5');
    await expect(screen.getByRole('row', new RegExp(packed.cartons[0].koli_number))).toContainText('Pack');
    await screen.getByRole('button', 'Board').tap();
    await expect(screen.getByRole('region', /^Pick List/)).toBeVisible();
  });

  test('OUT-32 searching the board and choosing a store narrow every lane', { session: 'nina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    const { a1, a2 } = await fourStages();
    await app.open('/operations/board');
    const pickLane = screen.getByRole('region', /^Pick List/);
    await expect(pickLane.getByRole('button', new RegExp(a1.allotment_number))).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('textbox', 'Search the board').fill(a1.allotment_number);
    await expect(pickLane.getByRole('button', new RegExp(a1.allotment_number))).toBeVisible();
    await expect(screen.getByRole('region', /^Picked/).getByRole('button', /C012 · Banjaran/)).toBeHidden();
    await screen.getByRole('textbox', 'Search the board').fill('');
    await screen.getByRole('combobox', 'Store').tap();
    await screen.getByRole('option', 'C012 · Banjaran').tap();
    await expect(pickLane.getByRole('button', new RegExp(a1.allotment_number))).toBeHidden();
    await expect(screen.getByRole('region', /^Picked/).getByRole('button', /C012 · Banjaran/)).toBeVisible();
    expect(a2.allotment_number).toBeTruthy();
    await ship(await packRemaining('store-12'));
  });

  test('OUT-33 a card opens the sheet of its stage: Picklist, Pack, Carton, Delivery note', { session: 'nina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen, browser }) => {
    const { a1, packed, sent } = await fourStages();
    await ship(await packRemaining('store-12'));
    await app.open('/operations/board');
    await screen.getByRole('region', /^Pick List/).getByRole('button', new RegExp(a1.allotment_number)).tap();
    await expect(browser).toHaveURL(/accept=/);
    await expect(screen.getByRole('dialog', 'Picklist')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Close').first().tap().catch(() => undefined);
    await app.open('/operations/board');
    await screen.getByRole('region', /^Pack/).getByRole('button', new RegExp(packed.cartons[0].koli_number)).tap();
    await expect(browser).toHaveURL(/koli=/);
    await expect(screen.getByRole('dialog', 'Carton')).toBeVisible({ timeout: 30_000 });
    await app.open('/operations/board');
    await screen.getByRole('region', /^Dispatch/).getByRole('button', new RegExp(sent.trip.dispatch.dispatch_number)).filter({ hasText: 'C002' }).tap();
    await expect(browser).toHaveURL(/shipment=/);
    await expect(screen.getByRole('dialog', /C002/)).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('dialog', /C002/)).toContainText('In transit');
  });
});
