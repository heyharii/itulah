// Ops › Packing: a shop's picked pieces go into a carton, drawn from its picklists, no RFID.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, rows } from '../../support/rig.ts';
import { allot, ownStock, pick, packRemaining, ship, shipReady, sum, waitToPick } from '../../support/outbound.ts';

/** Allot, wait for the DC and accept every picklist (as Nina does at the racks). */
async function picked(cells: { sku: any; store: string; qty: number }[], note: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const made = await allot(cells, note);
  const shops = new Set(cells.map((c) => c.store)).size;
  const sessions: Record<string, string[]> = {};
  for (const p of await waitToPick(made.allotment_number, shops)) (sessions[p.destination_id] ??= []).push((await pick(p)).summary.session.session_id);
  return { made, sessions };
}

describe('Ops › Packing', { tags: ['outbound'] }, () => {
  test('OUT-50 the Pack sheet draws from the shop\'s picklists and seals one carton of what was typed', { session: 'nina', tags: ['outbound', 'smoke'], timeout: 480_000 }, async ({ app, screen }) => {
    const s = await ownStock('pack', 80);
    await ship(await packRemaining('store-03'));
    const { made } = await picked([{ sku: s.skus[0], store: 'store-03', qty: 3 }, { sku: s.skus[1], store: 'store-03', qty: 2 }], `Uji pack ${s.t}`);
    await app.open('/operations/board');
    const card = screen.getByRole('region', /^Picked/).getByRole('button', /C003 · Purbalingga/).filter({ hasText: made.allotment_number });
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText('1 picklist');
    await expect(card).toContainText('5 pcs');
    await card.tap();
    const sheet = screen.getByRole('dialog', 'Pack');
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    await expect(sheet).toContainText('C003 · Purbalingga');
    await expect(sheet).toContainText('Lines');
    await expect(sheet).toContainText('Enter what went in the carton');
    await expect(sheet.getByRole('button', 'Pack and seal')).toBeDisabled();
    await sheet.getByRole('textbox', `Pack ${s.skus[0].sku_code}`).fill('3');
    await sheet.getByRole('textbox', `Pack ${s.skus[1].sku_code}`).fill('2');
    await expect(sheet).toContainText('2 items · 5 pcs');
    await sheet.getByRole('button', 'Pack and seal').tap();
    const done = screen.getByRole('dialog', 'Packed');
    await expect(done).toBeVisible({ timeout: 45_000 });
    await expect(done).toContainText('C003 · Purbalingga');
    await expect(done).toContainText('5');
    const cartons = rows(await as('dc', 'nina').get('/api/v1/dc/koli?ready=true')).filter((k) => k.destination_store_id === 'store-03' && k.unit_count === 5);
    expect(cartons.length).toBeGreaterThan(0);
    await shipReady('store-03');
  });

  test('OUT-51 a quantity above what is waiting is capped at it', { session: 'nina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    const s = await ownStock('pack', 80);
    await ship(await packRemaining('store-04'));
    await picked([{ sku: s.skus[2], store: 'store-04', qty: 2 }], `Uji pack cap ${s.t}`);
    await app.open('/operations/packing?pack=store-04');
    const sheet = screen.getByRole('dialog', 'Pack');
    const box = sheet.getByRole('textbox', `Pack ${s.skus[2].sku_code}`);
    await expect(box).toBeVisible({ timeout: 60_000 });
    await box.fill('50');
    await expect(box).toHaveValue('2');
    await box.fill('0');
    await expect(sheet.getByRole('button', 'Pack and seal')).toBeDisabled();
    await ship(await packRemaining('store-04'));
    await shipReady('store-04');
  });

  test('OUT-52 packing part of what was picked seals a smaller carton and leaves the rest waiting', { session: 'nina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    const s = await ownStock('pack', 80);
    await ship(await packRemaining('store-05'));
    const { made } = await picked([{ sku: s.skus[3], store: 'store-05', qty: 4 }], `Uji pack part ${s.t}`);
    await app.open('/operations/packing?pack=store-05');
    const sheet = screen.getByRole('dialog', 'Pack');
    await sheet.getByRole('textbox', `Pack ${s.skus[3].sku_code}`).fill('3');
    await sheet.getByRole('button', 'Pack and seal').tap();
    await expect(screen.getByRole('dialog', 'Packed')).toBeVisible({ timeout: 45_000 });
    const rounds = rows(await as('dc', 'nina').get('/api/v1/dc/picklists')).filter((r) => r.allotment_number === made.allotment_number);
    expect(sum(rounds.map((r) => r.waiting))).toBe(1);
    await app.open('/operations/board');
    await expect(screen.getByRole('region', /^Picked/).getByRole('button', /C005 · Jambi/)).toContainText(/\b1 pcs?\b/, { timeout: 60_000 });
    await ship(await packRemaining('store-05'));
    await shipReady('store-05');
  });

  test('OUT-53 two allotments picked for one shop are packed into one carton', { session: 'nina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    const s = await ownStock('pack', 80);
    await ship(await packRemaining('store-13'));
    const a = await picked([{ sku: s.skus[0], store: 'store-13', qty: 2 }], `Uji pack A ${s.t}`);
    const b = await picked([{ sku: s.skus[1], store: 'store-13', qty: 2 }], `Uji pack B ${s.t}`);
    await app.open('/operations/board');
    const card = screen.getByRole('region', /^Picked/).getByRole('button', /C013 · Wonosobo/).filter({ hasText: '2 picklists' });
    await expect(card.first()).toBeVisible({ timeout: 60_000 });
    await card.first().tap();
    const sheet = screen.getByRole('dialog', 'Pack');
    await sheet.getByRole('textbox', `Pack ${s.skus[0].sku_code}`).fill('2');
    await sheet.getByRole('textbox', `Pack ${s.skus[1].sku_code}`).fill('2');
    await sheet.getByRole('button', 'Pack and seal').tap();
    await expect(screen.getByRole('dialog', 'Packed')).toBeVisible({ timeout: 45_000 });
    const carton = rows(await as('dc', 'nina').get('/api/v1/dc/koli?ready=true')).find((k) => k.destination_store_id === 'store-13' && k.unit_count === 4);
    expect(carton).toBeTruthy();
    expect(a.sessions['store-13'].length + b.sessions['store-13'].length).toBe(2);
    await shipReady('store-13');
  });

  test('OUT-54 the Packing page lists the shops to pack and the sealed cartons, each with its Packing list', { session: 'nina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    const s = await ownStock('pack', 80);
    await picked([{ sku: s.skus[1], store: 'store-07', qty: 2 }], `Uji packing page ${s.t}`);
    await app.open('/operations/packing');
    await expect(screen.getByRole('heading', 'Packing')).toBeVisible({ timeout: 60_000 });
    for (const k of ['Shops to pack', 'Pcs to pack', 'Sealed today', 'Pcs sealed']) await expect(screen.getByText(k, { exact: true })).toBeVisible();
    await expect(screen.getByText('To pack', { exact: true }).first()).toBeVisible();
    await expect(screen.getByText('Cartons', { exact: true }).first()).toBeVisible();
    await expect(screen.getByRole('button', 'Packing list').first()).toBeVisible();
  });
});
