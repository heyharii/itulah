// Ops › Dispatch: tick sealed cartons, write the trip data, one act makes the surat jalan and sends the goods.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, rows, tag } from '../../support/rig.ts';
import { dispatchTrip, ownStock, toPacked, waitDetail } from '../../support/outbound.ts';

describe('Ops › Dispatch', { tags: ['outbound'] }, () => {
  test('OUT-60 ticking a carton on the board offers Dispatch; the trip data note goes onto the delivery note and the goods are in transit', { session: 'yusuf', tags: ['outbound', 'smoke'], timeout: 480_000 }, async ({ app, screen }) => {
    const s = await ownStock('dispatch', 80);
    const note = `Truk ${tag('TR')} B 9123 KXA`;
    const { made, cartons } = await toPacked([{ sku: s.skus[0], store: 'store-02', qty: 3 }], `Uji dispatch ${s.t}`);
    const koli = cartons[0];
    await app.open('/operations/board');
    const lane = screen.getByRole('region', /^Pack/);
    await expect(lane.getByRole('button', new RegExp(koli.koli_number))).toBeVisible({ timeout: 60_000 });
    await lane.getByRole('checkbox', `Select ${koli.koli_number}`).check();
    await lane.getByRole('button', /^Dispatch \(1\)/).tap();
    const sheet = screen.getByRole('dialog', 'Dispatch');
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    await expect(sheet).toContainText('Tick the cartons going on this trip.');
    await sheet.getByRole('button', /C002 · Muaro Bungo/).tap();
    await expect(sheet.getByRole('checkbox', koli.koli_number)).toBeChecked();
    await expect(sheet).toContainText(/1 trip · 1 delivery note · 1 store · 1 carton · 3 pcs/);
    await sheet.getByRole('textbox', 'Trip data').fill(note);
    await sheet.getByRole('button', 'Dispatch and print delivery note').tap();
    await expect(screen.getByText('1 delivery note · in transit')).toBeVisible({ timeout: 60_000 });
    const trips = rows(await as('dc', 'yusuf').get('/api/v1/dc/dispatches')).filter((t) => t.trip_note === note);
    expect(trips.length).toBe(1);
    expect(trips[0].unit_count).toBe(3);
    const detail = await as('dc', 'yusuf').get(`/api/v1/dc/dispatches/${trips[0].dispatch_id}`);
    expect(detail.shipments.map((x: any) => [x.destination_store_id, x.position])).toEqual([['store-02', 'IN_TRANSIT']]); // eslint-disable-line @typescript-eslint/no-explicit-any
    const d = await waitDetail(made.id, (x) => x.at_in_transit_qty === 3);
    expect(d.to_pack_qty).toBe(0);
  });

  test('OUT-61 one trip can carry cartons for several shops: one delivery note per shop, one trip number', { session: 'yusuf', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    const s = await ownStock('dispatch', 80);
    const note = `Truk ${tag('TR')}`;
    const { cartons } = await toPacked([{ sku: s.skus[1], store: 'store-03', qty: 2 }, { sku: s.skus[2], store: 'store-04', qty: 3 }], `Uji dispatch 2 ${s.t}`);
    await app.open('/operations/board');
    const lane = screen.getByRole('region', /^Pack/);
    for (const k of cartons) await lane.getByRole('checkbox', `Select ${k.koli_number}`).check({ timeout: 60_000 });
    await lane.getByRole('button', /^Dispatch \(2\)/).tap();
    const sheet = screen.getByRole('dialog', 'Dispatch');
    await expect(sheet).toContainText(/2 stores · 2 cartons · 5 pcs/);
    await sheet.getByRole('textbox', 'Trip data').fill(note);
    await sheet.getByRole('button', 'Dispatch and print delivery note').tap();
    await expect(screen.getByText('1 delivery note · in transit')).toBeVisible({ timeout: 60_000 });
    const trip = rows(await as('dc', 'yusuf').get('/api/v1/dc/dispatches')).find((t) => t.trip_note === note);
    const detail = await as('dc', 'yusuf').get(`/api/v1/dc/dispatches/${trip.dispatch_id}`);
    expect(detail.shipments.length).toBe(2);
    expect(new Set(detail.shipments.map((x: any) => x.shipment_number)).size).toBe(2); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(detail.dispatch.shipment_count).toBe(2);
  });

  test('OUT-62 a shop left off the trip keeps its carton on the Pack lane', { session: 'yusuf', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    const s = await ownStock('dispatch', 80);
    const { cartons } = await toPacked([{ sku: s.skus[0], store: 'store-05', qty: 2 }, { sku: s.skus[1], store: 'store-06', qty: 2 }], `Uji dispatch left ${s.t}`);
    await app.open('/operations/board');
    const lane = screen.getByRole('region', /^Pack/);
    for (const k of cartons) await lane.getByRole('checkbox', `Select ${k.koli_number}`).check({ timeout: 60_000 });
    await lane.getByRole('button', /^Dispatch \(2\)/).tap();
    const sheet = screen.getByRole('dialog', 'Dispatch');
    await expect(sheet).toContainText(/2 stores/);
    // focus the second shop and take its carton off the trip
    await sheet.getByRole('button', /C006 · Wiramode/).tap();
    await expect(sheet.getByText('Going on this trip.')).toBeVisible();
    await sheet.getByRole('checkbox', cartons[1].koli_number).uncheck();
    await expect(sheet.getByText('Not going on this trip.')).toBeVisible();
    await expect(sheet).toContainText(/1 store · 1 carton · 2 pcs/);
    await sheet.getByRole('button', 'Dispatch and print delivery note').tap();
    await expect(screen.getByText('1 delivery note · in transit')).toBeVisible({ timeout: 60_000 });
    const left = rows(await as('dc', 'yusuf').get('/api/v1/dc/koli?ready=true')).find((k) => k.koli_id === cartons[1].koli_id);
    expect(left?.position).toBe('PACKED');
    const sent = rows(await as('dc', 'yusuf').get('/api/v1/dc/koli')).find((k) => k.koli_id === cartons[0].koli_id);
    expect(sent?.position).toBe('IN_TRANSIT');
    await dispatchTrip([cartons[1].koli_id], 'Uji sisa');
  });

  test('OUT-63 with every carton unticked there is nothing to send', { session: 'yusuf', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    const s = await ownStock('dispatch', 80);
    const { cartons } = await toPacked([{ sku: s.skus[2], store: 'store-07', qty: 2 }], `Uji dispatch none ${s.t}`);
    await app.open('/operations/board');
    const lane = screen.getByRole('region', /^Pack/);
    await lane.getByRole('checkbox', `Select ${cartons[0].koli_number}`).check({ timeout: 60_000 });
    await lane.getByRole('button', /^Dispatch \(1\)/).tap();
    const sheet = screen.getByRole('dialog', 'Dispatch');
    await sheet.getByRole('button', /C007 · Brebes/).tap();
    await sheet.getByRole('checkbox', cartons[0].koli_number).uncheck();
    await expect(sheet).toContainText('Tick the cartons going on it');
    await expect(sheet.getByRole('button', 'Dispatch and print delivery note')).toBeDisabled();
  });

  test('OUT-64 the Dispatch page lists the delivery note with its trip data and opens it as a sheet', { session: 'yusuf', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    const s = await ownStock('dispatch', 80);
    const note = `Truk ${tag('TR')}`;
    const { cartons } = await toPacked([{ sku: s.skus[3], store: 'store-08', qty: 2 }], `Uji despatch page ${s.t}`);
    const trip = await dispatchTrip(cartons.map((k) => k.koli_id), note);
    await app.open('/operations/despatch');
    await expect(screen.getByRole('heading', 'Dispatch')).toBeVisible({ timeout: 60_000 });
    for (const k of ['Cartons ready to dispatch', 'Delivery note in transit', 'Cartons on the road', 'Trips today']) await expect(screen.getByText(k, { exact: true })).toBeVisible();
    const row = screen.getByRole('row', new RegExp(trip.dispatch.dispatch_number)).filter({ hasText: 'C008 · Pasuruan' });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row).toContainText(note);
    await expect(row).toContainText('In transit');
    await row.tap();
    const sheet = screen.getByRole('dialog', /C008/);
    await expect(sheet).toBeVisible();
    for (const term of ['Shop', 'Dispatched', 'Cartons', 'Pcs', 'Status', 'Trip data']) await expect(sheet).toContainText(term);
    await expect(sheet).toContainText(note);
    await expect(sheet).toContainText(cartons[0].koli_number);
  });

  test('OUT-65 the server stops what must not go: a carton twice, an empty trip, more than was picked', { session: 'yusuf', tags: ['outbound', 'api'], timeout: 480_000 }, async () => {
    const s = await ownStock('dispatch', 80);
    const { cartons } = await toPacked([{ sku: s.skus[0], store: 'store-09', qty: 2 }], `Uji hard stop ${s.t}`);
    await dispatchTrip(cartons.map((k) => k.koli_id), 'hard stop');
    const again = await as('dc', 'yusuf').call('POST', '/api/v1/dc/dispatch-trips', { koli_ids: [cartons[0].koli_id], trip_note: null, actor_id: 'yusuf', idempotency_key: crypto.randomUUID() }, { ok: false });
    expect(JSON.stringify(again)).toMatch(/already on a trip/);
    const none = await as('dc', 'yusuf').call('POST', '/api/v1/dc/dispatch-trips', { koli_ids: [], trip_note: null, actor_id: 'yusuf', idempotency_key: crypto.randomUUID() }, { ok: false });
    expect(JSON.stringify(none)).toMatch(/needs at least one sealed carton/);
    const more = await as('dc', 'nina').call('POST', '/api/v1/dc/packs', { destination_store_id: 'store-09', lines: [{ sku_code: s.skus[0].sku_code, quantity: 9 }], actor_id: 'nina', idempotency_key: crypto.randomUUID(), seal: true, pick_session_ids: [] }, { ok: false });
    expect(JSON.stringify(more)).toMatch(/waiting to be packed|asked for|nothing/i);
  });
});
