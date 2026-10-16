// Return PO (Procurement › Return PO, /procurement/returns · Ops board /operations/board/suppliers).
// With the Gudang in the cloud (INVENTORY_DC_HOSTING=cloud) the DC's routes are the cloud's own:
//  * a delivery note (surat jalan) is made PER SUPPLIER for every return of that supplier still waiting, and
//  * a hand-over needs its note first.
// Supplier 0001 (Garmen Nusantara) carries every other test's open returns, so the tests that make a note or hand
// over use a supplier of their own, with an address and a telephone for the "Kepada" block, and clear its waiting
// returns before they start: the note then holds exactly the return the test raised.
import { as, nudge, placePo, rows, supplier0001, tag, uid, waitFor, type ItemCtx } from './rig.ts';
import { countPo, review } from './po.ts';
import { dcReturns } from './rig.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const RETURN_SUPPLIER_NAME = 'Return PO e2e';
export const RETURN_ADDRESS = 'Jl. Retur Uji No. 7, Jakarta Barat';
export const RETURN_PHONE = '021-555-0107';

export interface ReturnSupplier {
  id: string;
  code: string;
  name: string;
}

/** Found by name or created once: a supplier of our own, with the contact the note prints. */
export async function returnSupplier(): Promise<ReturnSupplier> {
  const cloud = as('cloud', 'rina');
  const found = rows(await cloud.get(`/api/v1/suppliers?q=${encodeURIComponent(RETURN_SUPPLIER_NAME)}&limit=50`)).find((s) => s.name === RETURN_SUPPLIER_NAME);
  if (found) return { id: found.supplier_id, code: found.supplier_code, name: found.name };
  const made = await cloud.post('/api/v1/suppliers', {
    name: RETURN_SUPPLIER_NAME,
    contact_name: 'Uji Retur',
    phone: RETURN_PHONE,
    email: null,
    address: RETURN_ADDRESS,
    status: 'ACTIVE',
    category: 'MERCHANDISE',
    legal_form: 'PT',
  });
  return { id: made.supplier_id, code: made.supplier_code, name: made.name };
}

async function itemOn(sup: ReturnSupplier, t: string): Promise<ItemCtx> {
  const item = await as('cloud', 'rina').post(`/api/v1/suppliers/${sup.id}/items`, {
    supplier_item_code: `${t}-KAO`,
    name: `Kaos Uji ${t}`,
    unit_price_minor: 40_000,
    currency: 'IDR',
    status: 'ACTIVE',
    division_code: 'PRIA',
    tags: ['KAOS'],
    colour_codes: ['BLACK', 'WHITE'],
    size_codes: ['03', '04'],
  });
  return { supplier: { supplier_id: sup.id, supplier_code: sup.code, name: sup.name }, item };
}

/** The supplier's returns still waiting for the warehouse to hand them over. */
async function waiting(sup: ReturnSupplier): Promise<Json[]> {
  return rows(await as('dc', 'nina').get('/api/v1/dc/purchase-returns')).filter((r) => r.supplier_id === sup.code && r.status === 'OPEN');
}

/** The delivery note for the given returns (the route Generate Delivery Note uses). */
export function makeNote(returnIds: string[], pic = 'Pak Joko') {
  return as('dc', 'nina').post('/api/v1/dc/purchase-returns/note', { return_ids: returnIds, pic });
}

/** A hand-over done properly: note first, then hand over. */
export async function handOverWithNote(returnId: string, pic = 'Pak Joko', handedTo = 'Pak Joko') {
  await makeNote([returnId], pic);
  return as('dc', 'nina').post(`/api/v1/dc/purchase-returns/${returnId}/hand-over`, { actor_id: 'nina', handed_to: handedTo, idempotency_key: uid() });
}

/** Leave the supplier with nothing waiting: whatever earlier tests raised is noted and handed over. */
export async function clearSupplier(sup: ReturnSupplier) {
  for (const one of await waiting(sup)) await handOverWithNote(one.return_id, 'Pak Sisa');
}

/**
 * A PO on the return supplier counted `counted` of 8 (`wrong` of them Not as Ordered), accepted, and the return
 * raised. `clear` first empties the supplier's waiting returns so a note covers this one alone.
 */
export async function ownReturn(counted = 11, wrong = 0, { clear = false } = {}) {
  const sup = await returnSupplier();
  if (clear) await clearSupplier(sup);
  const t = tag('RT');
  const ctx = await itemOn(sup, t);
  const po = await placePo(ctx, 8, { notes: `Uji retur ${t}` });
  const { count } = await countPo(ctx, po, counted, wrong);
  await review(count.count_id, 'Accept');
  await waitFor(`${po} excess pending`, async () => {
    await nudge('dc', 'cloud');
    const d = rows(await as('cloud', 'rina').get('/api/v1/purchase-orders?limit=500')).find((x) => x.po_number === po);
    return d && d.excess_pending_stock_units > 0 ? d : null;
  }, 90_000, 2_000);
  const { raiseReturn } = await import('./rig.ts');
  const ret = await raiseReturn(po);
  const [dc] = await waitFor(`${po} return at the DC`, async () => {
    const r = await dcReturns(po);
    return r.length ? r : null;
  }, 90_000, 2_000);
  return { t, sup, ctx, po, ret, dc };
}

export { supplier0001 };
