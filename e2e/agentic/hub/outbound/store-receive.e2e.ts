// The store receives the truck: blind count at store-01 (maya, through the store node), then what Central and the DC show.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, rows, tag } from '../../support/rig.ts';
import {
  inboundFor, ownStock, shipmentOf, storeReceive, toInTransit, waitDetail,
} from '../../support/outbound.ts';

const maya = () => as('store', 'maya');
const warehouse = async () => rows(await maya().get('/api/v1/inventory/pools')).find((p) => p.id === 'store-01.warehouse')?.on_hand as number;

/** Two SKUs to store-01 (3 + 2), one SKU to store-02, on one trip. */
async function truck(note: string) {
  const s = await ownStock('receive', 160);
  const sent = await toInTransit([{ sku: s.skus[0], store: 'store-01', qty: 3 }, { sku: s.skus[1], store: 'store-01', qty: 2 }, { sku: s.skus[2], store: 'store-02', qty: 2 }], note, `Truk ${tag('TR')}`);
  const sj = shipmentOf(sent.trip, 'store-01');
  const inbound = await inboundFor(sj.shipment_number);
  return { s, sent, sj, inbound };
}

describe('Store receives the truck', { tags: ['outbound'] }, () => {
  test('OUT-70 the store sees the delivery coming but not what was packed (blind)', { tags: ['outbound', 'smoke'], timeout: 480_000 }, async () => {
    const { sj, inbound } = await truck('Uji blind');
    expect(inbound.status).toBe('IN_TRANSIT');
    expect(inbound.result).toBeNull();
    expect(inbound.shipment_reference).toBe(sj.shipment_number);
    expect(inbound.koli_count).toBe(1);
    const detail = JSON.stringify(await maya().get(`/api/v1/store/inbound/${inbound.delivery_id}`));
    expect(detail).not.toMatch(/"packed|"expected|"manifest|"unit_count/);
  });

  test('OUT-71 counting exactly what came receives it: the store warehouse grows and Central shows it received', { tags: ['outbound'], timeout: 480_000 }, async () => {
    const { s, sent, inbound } = await truck('Uji receive');
    const before = await warehouse();
    const got = await storeReceive(inbound.delivery_id, [{ sku_code: s.skus[0].sku_code, quantity: 3 }, { sku_code: s.skus[1].sku_code, quantity: 2 }]);
    expect(got.delivery.status).toBe('RECEIVED');
    expect(got.delivery.received_by).toBe('maya');
    expect(got.delivery.result).toEqual({ expected_units: 5, received_units: 5, missing_units: 0, extra_units: 0 });
    expect(await warehouse()).toBe(before + 5);
    const d = await waitDetail(sent.made.id, (x) => x.received_qty >= 5);
    expect(d.received_qty).toBe(5);
    expect(d.receiving_gap_qty).toBe(0);
    // store-02's part of the trip has no node on this rig: still on the road
    const left = rows(await as('dc', 'yusuf').get('/api/v1/dc/shipments')).find((x) => x.dispatch_id === sent.trip.dispatch.dispatch_id && x.destination_store_id === 'store-02');
    expect(left?.position).toBe('IN_TRANSIT');
  });

  test('OUT-72 counting less than came receives what was counted and leaves the missing piece owed', { session: 'rina', tags: ['outbound'], timeout: 480_000 }, async ({ app, screen }) => {
    const { s, sent, inbound } = await truck('Uji missing');
    const before = await warehouse();
    const got = await storeReceive(inbound.delivery_id, [{ sku_code: s.skus[0].sku_code, quantity: 3 }, { sku_code: s.skus[1].sku_code, quantity: 1 }]);
    expect(got.delivery.result).toEqual({ expected_units: 5, received_units: 4, missing_units: 1, extra_units: 0 });
    expect(got.lines.find((l: any) => l.sku_code === s.skus[1].sku_code).missing).toBe(1); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await warehouse()).toBe(before + 4);
    // Central: 4 received, the missing piece still to receive (Missing is switched off, so no gap is booked)
    const d = await waitDetail(sent.made.id, (x) => x.received_qty === 4);
    // to receive = the missing piece (store-01) + the 2 pieces still on the road to store-02
    expect(d.to_receive_qty).toBe(3);
    expect(d.lines.filter((l: any) => l.destination_id === 'store-01').map((l: any) => l.to_receive_qty).sort()).toEqual([0, 1]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(d.receiving_gap_qty).toBe(0);
    await app.open(`/allotment?allotment=${sent.made.id}`);
    const sheet = screen.getByRole('dialog', new RegExp(`^${sent.made.allotment_number}`));
    await expect(sheet.getByText('Lines')).toBeVisible({ timeout: 60_000 });
    await expect(sheet.getByText(/were handed over but not found at the store/)).toBeHidden();
  });

  test('OUT-73 a delivery is received once; a second count is refused', { tags: ['outbound'], timeout: 480_000 }, async () => {
    const { s, inbound } = await truck('Uji twice');
    await storeReceive(inbound.delivery_id, [{ sku_code: s.skus[0].sku_code, quantity: 3 }, { sku_code: s.skus[1].sku_code, quantity: 2 }]);
    const again = await maya().call('POST', `/api/v1/store/inbound/${inbound.delivery_id}/receive-count`, {
      counts: [{ sku_code: s.skus[0].sku_code, quantity: 3 }], actor_id: 'maya', idempotency_key: crypto.randomUUID(),
    }, { ok: false });
    expect(JSON.stringify(again)).toMatch(/error/);
  });

  test('OUT-74 a count that names nothing on the delivery is refused', { tags: ['outbound'], timeout: 480_000 }, async () => {
    const { s, inbound } = await truck('Uji empty count');
    const bad = await maya().call('POST', `/api/v1/store/inbound/${inbound.delivery_id}/receive-count`, {
      counts: [{ sku_code: s.skus[3].sku_code, quantity: 1 }], actor_id: 'maya', idempotency_key: crypto.randomUUID(),
    }, { ok: false });
    expect(JSON.stringify(bad)).toMatch(/nothing counted matches this delivery/);
    const still = rows(await maya().get('/api/v1/store/inbound')).find((d) => d.delivery_id === inbound.delivery_id);
    expect(still?.status).toBe('IN_TRANSIT');
  });

  test('OUT-75 [bug] counting more than was packed is reported as extra, not silently dropped', { tags: ['outbound', 'bug'], timeout: 480_000 }, async () => {
    const { s, inbound } = await truck('Uji extra');
    const got = await storeReceive(inbound.delivery_id, [{ sku_code: s.skus[0].sku_code, quantity: 5 }, { sku_code: s.skus[1].sku_code, quantity: 2 }]);
    // 5 counted for 3 packed: the 2 pieces over must show up as extra
    expect(got.delivery.result.extra_units).toBe(2);
  });

  test('OUT-76 once received, the delivery leaves the Dispatch lane and shows on the Received lane', { session: 'nina', tags: ['outbound', 'bug'], timeout: 480_000 }, async ({ app, screen }) => {
    const { s, sent, inbound, sj } = await truck('Uji lanes');
    await storeReceive(inbound.delivery_id, [{ sku_code: s.skus[0].sku_code, quantity: 3 }, { sku_code: s.skus[1].sku_code, quantity: 2 }]);
    await waitDetail(sent.made.id, (x) => x.received_qty >= 5);
    await app.open('/operations/board');
    const received = screen.getByRole('region', /^Received/);
    await expect(received.getByRole('button', new RegExp(sent.trip.dispatch.dispatch_number)).filter({ hasText: 'C001' })).toBeVisible({ timeout: 90_000 });
    const road = screen.getByRole('region', /^Dispatch/);
    await expect(road.getByRole('button', new RegExp(sent.trip.dispatch.dispatch_number)).filter({ hasText: 'C001' })).toBeHidden();
    // store-02 has not received: its note stays on the road
    await expect(road.getByRole('button', new RegExp(sent.trip.dispatch.dispatch_number)).filter({ hasText: 'C002' })).toBeVisible();
    expect(sj.shipment_number).toBeTruthy();
  });
});
