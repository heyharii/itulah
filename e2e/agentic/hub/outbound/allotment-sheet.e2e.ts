// The allotment sheet (/allotment?allotment=<id>): lines, Cancel allotment, Edit — on the rig's edge-run (DC-owned) allotments.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as } from '../../support/rig.ts';
import {
  allot, allotmentDetail, freeOf, openAllotmentSheet, ownStock, pick, toInTransit, toPick, waitAccepted, waitDetail, waitToPick,
} from '../../support/outbound.ts';

const cancelDialog = (screen: any, number: string) => screen.getByRole('dialog', new RegExp(`^Cancel ${number}`)); // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Allotment sheet', { tags: ['outbound'] }, () => {
  test('OUT-20 the sheet reads as a document: lines per store with totals, Cancel allotment and Edit in the foot', { session: 'rina', tags: ['outbound', 'smoke'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await ownStock('sheet', 80);
    const made = await allot([{ sku: s.skus[0], store: 'store-01', qty: 3 }, { sku: s.skus[1], store: 'store-02', qty: 2 }, { sku: s.skus[2], store: 'store-02', qty: 4 }], `Uji sheet ${s.t}`);
    const sheet = await openAllotmentSheet(app, screen, made.id, made.allotment_number);
    await expect(sheet).toContainText('Created');
    await expect(sheet).toContainText('by rina');
    await expect(sheet).toContainText(s.article);
    await expect(sheet.getByText('Store 01')).toBeVisible();
    await expect(sheet.getByText('Store 02')).toBeVisible();
    await expect(sheet.getByText(s.skus[0].sku_code)).toBeVisible();
    await expect(sheet.getByText('Total', { exact: true }).first()).toBeVisible();
    await expect(sheet.getByRole('button', 'Cancel allotment')).toBeVisible();
    await expect(sheet.getByRole('button', 'Edit')).toBeVisible();
    await expect(sheet.getByRole('button', /^Activity/)).toBeVisible();
  });

  test('OUT-21 until the DC accepts, the sheet says so and Cancel allotment is disabled', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen, browser }) => {
    const s = await ownStock('sheet', 80);
    const made = await allot([{ sku: s.skus[0], store: 'store-03', qty: 1 }], `Uji pending ${s.t}`);
    // The DC takes an allotment within seconds; hold the detail at PENDING to see the branch.
    const real = await allotmentDetail(made.id);
    await browser.route(`**/api/v1/inventory/allotments/${made.id}`, async (route: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      await route.fulfill({ status: 200, json: { ...real, edge_application_status: 'PENDING', cancellation: null } });
    });
    const sheet = await openAllotmentSheet(app, screen, made.id, made.allotment_number);
    await expect(sheet.getByText("Waiting for the DC to accept this allotment. It can't be closed short until then.")).toBeVisible();
    await expect(sheet.getByRole('button', 'Cancel allotment')).toBeDisabled();
  });

  test('OUT-22 a refused allotment says the DC refused it', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen, browser }) => {
    const s = await ownStock('sheet', 80);
    const made = await allot([{ sku: s.skus[0], store: 'store-03', qty: 1 }], `Uji refused ${s.t}`);
    const real = await allotmentDetail(made.id);
    await browser.route(`**/api/v1/inventory/allotments/${made.id}`, async (route: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      await route.fulfill({ status: 200, json: { ...real, edge_application_status: 'REJECTED' } });
    });
    const sheet = await openAllotmentSheet(app, screen, made.id, made.allotment_number);
    await expect(sheet.getByText('The DC refused this allotment.')).toBeVisible();
  });

  test('OUT-23 the Cancel dialog asks for a reason, offers five, and Keep leaves the allotment alone', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await ownStock('sheet', 80);
    const made = await allot([{ sku: s.skus[0], store: 'store-03', qty: 3 }, { sku: s.skus[1], store: 'store-04', qty: 2 }], `Uji dialog ${s.t}`);
    await waitAccepted(made.id);
    const sheet = await openAllotmentSheet(app, screen, made.id, made.allotment_number);
    await sheet.getByRole('button', 'Cancel allotment').tap();
    const dialog = cancelDialog(screen, made.allotment_number);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('5 pcs still to pack is released. Anything already picked stays picked.')).toBeVisible();
    for (const reason of ['Wrong quantity', 'Wrong store', 'Stock problem', 'Supplier', 'Other']) await expect(dialog.getByRole('radio', reason)).toBeVisible();
    await expect(dialog.getByRole('button', 'Cancel allotment')).toBeDisabled();
    await dialog.getByRole('radio', 'Wrong store').tap();
    await expect(dialog.getByRole('button', 'Cancel allotment')).toBeEnabled();
    await dialog.getByRole('button', 'Keep').tap();
    await expect(dialog).toBeHidden();
    const d = await allotmentDetail(made.id);
    expect(d.status).toBe('ACTIVE');
    expect(d.cancellation).toBeNull();
  });

  test('OUT-24 cancelling an allotment nobody has picked sends it to the DC, releases every piece and shows Cancelled', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await ownStock('sheet', 80);
    const before = await freeOf(s.skus[0]);
    const made = await allot([{ sku: s.skus[0], store: 'store-03', qty: 3 }, { sku: s.skus[1], store: 'store-04', qty: 2 }], `Uji cancel ${s.t}`);
    await waitAccepted(made.id);
    const sheet = await openAllotmentSheet(app, screen, made.id, made.allotment_number);
    await sheet.getByRole('button', 'Cancel allotment').tap();
    const dialog = cancelDialog(screen, made.allotment_number);
    await dialog.getByRole('radio', 'Wrong store').tap();
    await dialog.getByRole('textbox', 'Note').fill('Toko salah');
    await dialog.getByRole('button', 'Cancel allotment').tap();
    await expect(screen.getByText('Sent to the DC. Cancelling')).toBeVisible({ timeout: 30_000 });
    const d = await waitDetail(made.id, (x) => x.status === 'CANCELLED');
    expect(d.cancellation.reason).toBe('Wrong store · Toko salah');
    expect(d.to_pack_qty).toBe(0);
    expect(await freeOf(s.skus[0])).toBe(before);
    await expect(sheet.getByText('Cancelled', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(sheet.getByText('Cancelled by')).toBeVisible();
    await expect(sheet.getByText('Wrong store · Toko salah')).toBeVisible();
    // the picklists are gone from the DC
    expect((await toPick()).filter((p) => p.allotment_number === made.allotment_number).length).toBe(0);
  });

  test('OUT-25 cancelling after part of it was picked keeps what was picked and cancels the rest', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await ownStock('sheet', 80);
    const made = await allot([{ sku: s.skus[0], store: 'store-06', qty: 4 }], `Uji cancel picked ${s.t}`);
    await waitAccepted(made.id);
    const [p] = await waitToPick(made.allotment_number);
    await pick(p, { [s.skus[0].sku_code]: 3 });
    const sheet = await openAllotmentSheet(app, screen, made.id, made.allotment_number);
    await sheet.getByRole('button', 'Cancel allotment').tap();
    const dialog = cancelDialog(screen, made.allotment_number);
    await dialog.getByRole('radio', 'Other').tap();
    await dialog.getByRole('button', 'Cancel allotment').tap();
    await expect(screen.getByText('Sent to the DC. Cancelling')).toBeVisible({ timeout: 30_000 });
    const d = await waitDetail(made.id, (x) => x.cancellation?.status === 'PARTIALLY_APPLIED' || x.status === 'CANCELLED');
    expect(d.cancellation.cancelled_quantity).toBe(1);
    expect(d.cancellation.blocked_picked_quantity).toBe(3);
    // MD sees Cancelled at once, whoever's work is still to do
    await expect(sheet.getByText('Cancelled', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('OUT-26 once everything is sent there is nothing left to cancel or edit', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await ownStock('sheet', 80);
    const sent = await toInTransit([{ sku: s.skus[3], store: 'store-01', qty: 2 }], `Uji sent ${s.t}`);
    await waitDetail(sent.made.id, (x) => x.to_pack_qty === 0 && x.at_in_transit_qty === 2);
    const sheet = await openAllotmentSheet(app, screen, sent.made.id, sent.made.allotment_number);
    await expect(sheet.getByText('Everything has already been sent.')).toBeVisible();
    await expect(sheet.getByRole('button', 'Cancel allotment')).toBeDisabled();
    await expect(sheet.getByRole('button', 'Edit')).toBeDisabled();
  });

  test('OUT-27 Edit asks first, closes this allotment and opens New allotment filled in to change', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen, browser }) => {
    const s = await ownStock('sheet', 80);
    const made = await allot([{ sku: s.skus[0], store: 'store-07', qty: 3 }, { sku: s.skus[1], store: 'store-08', qty: 2 }], `Uji edit ${s.t}`);
    await waitAccepted(made.id);
    const sheet = await openAllotmentSheet(app, screen, made.id, made.allotment_number);
    await sheet.getByRole('button', 'Edit').tap();
    await expect(screen.getByText('Edit this allotment?')).toBeVisible();
    await expect(screen.getByText('5 still to pack opens in New allotment, filled in, to change and save. This allotment is replaced.')).toBeVisible();
    await screen.getByRole('dialog', /Edit this allotment/).getByRole('button', 'Edit').tap();
    await expect(browser).toHaveURL(/\/allotment\/new\?.*allotFrom=reallot/, { timeout: 60_000 });
    await expect(screen.getByText(`Re-allot of ${made.allotment_number}`)).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByLabel(`${s.skus[0].sku_code} to C007 · Brebes`)).toHaveValue('3', { timeout: 30_000 });
    await expect(screen.getByLabel(`${s.skus[1].sku_code} to C008 · Pasuruan`)).toHaveValue('2');
    // the old allotment is closed for good
    const d = await waitDetail(made.id, (x) => x.status === 'CANCELLED');
    expect(d.cancellation.reason).toBe('Edited');
    // move one piece to another store and submit: the new allotment carries the change
    await screen.getByLabel(`${s.skus[0].sku_code} to C007 · Brebes`).fill('2');
    await screen.getByLabel(`${s.skus[0].sku_code} to C009 · WMJB`).fill('1');
    await screen.getByRole('button', 'Submit').first().tap();
    await expect(screen.getByText(/^Saved ALT-\d+ \(/)).toBeVisible({ timeout: 60_000 });
  });

  test('OUT-28 the in-place Edit page refuses a DC-run allotment', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await ownStock('sheet', 80);
    const made = await allot([{ sku: s.skus[0], store: 'store-09', qty: 1 }], `Uji edit page ${s.t}`);
    await waitAccepted(made.id);
    await app.open(`/allotment/new?allotFrom=edit~${made.id}`);
    await expect(screen.getByRole('heading', `Edit ${made.allotment_number}`)).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText('This allotment is run by its DC; edit it from the allotment.')).toBeVisible();
  });

  test('OUT-29 the history lists what happened to the allotment', { session: 'rina', tags: ['outbound'], timeout: 420_000 }, async ({ app, screen }) => {
    const s = await ownStock('sheet', 80);
    const made = await allot([{ sku: s.skus[2], store: 'store-10', qty: 2 }], `Uji activity ${s.t}`);
    const sheet = await openAllotmentSheet(app, screen, made.id, made.allotment_number);
    await sheet.getByRole('button', /^Activity/).tap();
    await expect(sheet).toContainText('Rina Kusuma created this record');
  });
});
