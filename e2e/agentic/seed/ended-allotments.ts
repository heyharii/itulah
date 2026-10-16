// Seed for the Allotments page's Completed tab: one allotment per way it can
// end, all to store-01 (the only store with a node on the rig), run through the
// real chain — allot → pick → (close short) → pack → dispatch → store counts.
//   Closed short   : 4 asked, 3 picked, MD closes the 1 left, store receives 3
//   Received short : 4 sent, store counts 3
//   Completed      : 4 sent, store counts 4
// An allotment can be named on the command line (`Closed short=ALT-00000227`)
// to carry on with one already raised; the rest are raised from free stock.
// Run on the rig's VM:  cd ~/itulah/e2e/agentic && node --experimental-transform-types seed/ended-allotments.ts
// (RIG_DC_HOSTING=edge when the rig still has its own DC node.)
import { as, nudge, rows, uid, waitFor } from '../support/rig.ts';
import {
  allot, allotmentByNumber, allotmentDetail, availability, dispatchTrip, inboundFor, pack, pick, shipmentOf, storeReceive, waitAccepted,
} from '../support/outbound.ts';

const STORE = 'store-01';
const named = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));

/** Same as outbound.ts `waitToPick`, but patient: the rig is slow while other suites run. */
function waitToPick(number: string) {
  return waitFor(`${number} on the DC to-pick list`, async () => {
    await nudge('cloud', 'dc');
    const mine = rows(await as('dc', 'nina').get('/api/v1/dc/picklist/allotments')).filter((p) => p.allotment_number === number);
    return mine.length > 0 ? mine : null;
  }, 900_000, 5_000);
}

async function journey(label: string, picked: number, closeShort: number, received: number, free: () => { sku_code: string; sku_id: string; article_name: string }) {
  let made = named[label] ? await allotmentByNumber(named[label]) : undefined;
  if (!made) made = await allot([{ sku: free() as never, store: STORE, qty: 4 }], `Seed ${label}`);
  let detail = await allotmentDetail(made!.id);
  // A cloud-hosted Gudang has no node to accept it: the cloud works it itself.
  if (detail.activation_target_origin_id) detail = await waitAccepted(made!.id);
  const line = detail.lines[0];
  const [p] = await waitToPick(made!.allotment_number);
  const sessionId = (await pick(p, { [line.sku_code]: picked })).summary.session.session_id;
  if (closeShort > 0) {
    await as('cloud', 'rina').post(`/api/v1/inventory/allotments/${made!.id}/close-short`, {
      idempotency_key: uid(), lines: [{ allotment_line_id: line.id, quantity: closeShort }], reason: null,
    });
  }
  const manifest = await pack(STORE, [{ sku_code: line.sku_code, quantity: picked }], [sessionId]);
  const trip = await dispatchTrip([manifest.koli.koli_id], `Seed ${label}`);
  const inbound = await inboundFor(shipmentOf(trip, STORE).shipment_number, 600_000);
  await storeReceive(inbound.delivery_id, [{ sku_code: line.sku_code, quantity: received }]);
  console.log(`${label}: ${made!.allotment_number}`);
}

// SKUs the DC already holds free (the rig has hundreds from earlier runs).
const stock = (await availability()).filter((r) => r.on_hand_qty >= 4 && r.sku_code && r.sku_id);
let next = stock.length;
const free = () => {
  if (next <= 0) throw new Error('no SKU with 4 free pieces left — seed stock first');
  return stock[--next];
};
await journey('Closed short', 3, 1, 3, free);
await journey('Received short', 4, 0, 3, free);
await journey('Completed', 4, 0, 4, free);
console.log('done');
