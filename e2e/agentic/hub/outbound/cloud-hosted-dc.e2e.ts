// Branches that need the cloud-hosted Gudang (INVENTORY_DC_HOSTING=cloud): amend / cancel with work owed,
// Move back, the hard stop on a carton MD took out, short-pick flags and Close remaining.
// The rig's DC is a separate edge node, where these routes answer 404 / "Edge-owned allotment ...", so they are
// written from docs/research/2026-10-09-outbound-cancel-edit-build.md and the screens, and skipped here.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as } from '../../support/rig.ts';
import { allot, allotmentDetail, CLOUD_DC, ownStock, pick, toPacked, waitToPick } from '../../support/outbound.ts';

const skip = () => test.skip(!CLOUD_DC, 'needs the cloud-hosted DC (RIG_DC_HOSTING=cloud): this rig runs an edge DC node');

describe('Cloud-hosted Gudang', { tags: ['outbound'] }, () => {
  test('OUT-90 Edit opens the same grid filled with the allotment; Was / Now and Save changes amend it in place', { session: 'rina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    skip();
    const s = await ownStock('cloud', 80);
    const made = await allot([{ sku: s.skus[0], store: 'store-01', qty: 4 }, { sku: s.skus[1], store: 'store-02', qty: 4 }], `Uji amend ${s.t}`);
    await app.open(`/allotment/new?allotFrom=edit~${made.id}`);
    await expect(screen.getByRole('heading', `Edit ${made.allotment_number}`)).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText('No changes yet')).toBeVisible();
    await expect(screen.getByRole('button', 'Save changes')).toBeDisabled();
    const box = screen.getByLabel(`${s.skus[0].sku_code} to C001 · Cikupa`);
    await box.fill('3');
    await expect(screen.getByText('Was')).toBeVisible();
    await expect(screen.getByText('8 pcs')).toBeVisible();
    await expect(screen.getByText('7 pcs')).toBeVisible();
    await screen.getByRole('button', 'Save changes').tap();
    await expect(screen.getByText(`${made.allotment_number} saved`)).toBeVisible({ timeout: 30_000 });
    const d = await allotmentDetail(made.id);
    expect(d.lines.find((l: any) => l.sku_code === s.skus[0].sku_code).target_quantity).toBe(3); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  test('OUT-91 an edit never goes below what is already sent (the cell refuses it)', { session: 'rina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    skip();
    const s = await ownStock('cloud', 80);
    const made = await allot([{ sku: s.skus[2], store: 'store-03', qty: 4 }], `Uji floor ${s.t}`);
    const [p] = await waitToPick(made.allotment_number);
    await pick(p);
    await app.open(`/allotment/new?allotFrom=edit~${made.id}`);
    const box = screen.getByLabel(`${s.skus[2].sku_code} to C003 · Purbalingga`);
    await box.fill('0');
    await expect(box).toHaveAttribute('title', /already sent: it cannot go lower/);
  });

  test('OUT-92 cancelling picked or packed work asks for a ticked acknowledgement before it goes', { session: 'rina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    skip();
    const s = await ownStock('cloud', 80);
    const { made } = await toPacked([{ sku: s.skus[3], store: 'store-04', qty: 3 }], `Uji cancel work ${s.t}`);
    await app.open(`/allotment?allotment=${made.id}`);
    const sheet = screen.getByRole('dialog', new RegExp(`^${made.allotment_number}`));
    await sheet.getByRole('button', 'Cancel allotment').tap();
    const dialog = screen.getByRole('dialog', new RegExp(`^Cancel ${made.allotment_number}`));
    await expect(dialog.getByText('Packed')).toBeVisible();
    await expect(dialog.getByText(/the warehouse unpacks it/)).toBeVisible();
    await dialog.getByRole('radio', 'Other').tap();
    await expect(dialog.getByRole('button', 'Cancel allotment')).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await expect(dialog.getByRole('button', 'Cancel allotment')).toBeEnabled();
  });

  test('OUT-93 a carton holding pieces MD took out cannot be ticked for Dispatch until they are moved back', { session: 'nina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    skip();
    const s = await ownStock('cloud', 80);
    const { made, cartons } = await toPacked([{ sku: s.skus[0], store: 'store-05', qty: 4 }], `Uji hard stop ${s.t}`);
    await as('cloud', 'rina').post(`/api/v1/inventory/allotments/${made.id}/cancel`, { reason: 'Other', actor_id: 'rina', idempotency_key: crypto.randomUUID() });
    await app.open('/operations/board');
    const lane = screen.getByRole('region', /^Pack/);
    await expect(lane.getByRole('checkbox', `Select ${cartons[0].koli_number}`)).toBeDisabled({ timeout: 60_000 });
    await expect(lane.getByText('CANCELLED')).toBeVisible();
    await expect(lane.getByRole('button', 'Move back').first()).toBeVisible();
  });

  test('OUT-94 Move back puts packed pieces back on the picked list', { session: 'nina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    skip();
    const s = await ownStock('cloud', 80);
    const { cartons } = await toPacked([{ sku: s.skus[1], store: 'store-06', qty: 3 }], `Uji move back ${s.t}`);
    await app.open('/operations/board');
    await screen.getByRole('region', /^Pack/).getByRole('button', new RegExp(cartons[0].koli_number)).tap();
    await screen.getByRole('button', 'Move back').first().tap();
    const dialog = screen.getByRole('dialog', /^Move back from C006/);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', /^Move back/).last().tap();
    await expect(screen.getByRole('region', /^Picked/).getByRole('button', /C006 · Wiramode/)).toBeVisible({ timeout: 60_000 });
  });

  test('OUT-95 a short pick flags the picklist for MD, who sees Still needed and can Close remaining', { session: 'rina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    skip();
    const s = await ownStock('cloud', 80);
    const made = await allot([{ sku: s.skus[2], store: 'store-07', qty: 4 }], `Uji close remaining ${s.t}`);
    const [p] = await waitToPick(made.allotment_number);
    await pick(p, { [s.skus[2].sku_code]: 3 });
    await as('dc', 'nina').post('/api/v1/dc/short-picks', { idempotency_key: crypto.randomUUID(), allotment_id: made.id, destination_id: 'store-07', sku_code: s.skus[2].sku_code, pieces: 1, reason: 'OTHER' });
    await app.open('/allotment');
    await screen.getByRole('tab', /^Still needed/).tap();
    const row = screen.getByRole('row', new RegExp(made.allotment_number));
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.getByRole('button', 'Close remaining').tap();
    await screen.getByRole('dialog', 'Close remaining?').getByRole('button', 'Close remaining').tap();
    await screen.getByRole('tab', /^Closed short/).tap();
    await expect(screen.getByRole('row', new RegExp(made.allotment_number))).toBeVisible({ timeout: 60_000 });
  });
});
