// Check (10 Oct 2026): picked pieces MD reduces stay reserved until the Gudang
// moves them back. Allot 4 → pick 4 → MD reduces to 2 → free stock unchanged
// → move back 2 → free stock up by 2. Run on the rig's VM (cloud-hosted DC):
//   cd ~/itulah/e2e/agentic && node --experimental-transform-types seed/check-pick-owed.ts
import { as, uid } from '../support/rig.ts';
import { allot, allotmentDetail, availability, pick, waitToPick } from '../support/outbound.ts';

const STORE = 'store-02';
const cloud = as('cloud', 'rina');
const free = async (code: string) => (await availability()).find((r) => r.sku_code === code)?.on_hand_qty ?? 0;

const candidate = (await availability()).filter((r) => r.on_hand_qty >= 4 && r.sku_id).pop();
if (!candidate) throw new Error('no SKU with 4 free');
const code = candidate.sku_code;
const f0 = await free(code);
const made = await allot([{ sku: candidate, store: STORE, qty: 4 }], 'Check pick owed');
const [p] = await waitToPick(made.allotment_number);
await pick(p, { [code]: 4 });
const f1 = await free(code);
const line = (await allotmentDetail(made.id)).lines[0];
await cloud.post(`/api/v1/inventory/allotments/${made.id}/amend`, { idempotency_key: uid(), reason: 'check', lines: [{ allotment_line_id: line.id, to: 2 }] });
const f2 = await free(code);
const owed = (await as('dc', 'nina').get('/api/v1/dc/owed')) as any;
const card = (owed.items ?? owed).find((c: any) => c.allotment_id === made.id);
const changes = (await as('dc', 'nina').get('/api/v1/dc/changes')) as any;
const change = changes.items.find((c: any) => c.allotment_id === made.id);
await as('dc', 'nina').post('/api/v1/dc/move-back', { idempotency_key: uid(), destination_id: STORE, allotment_id: made.id, from: 'picked', to: 'pick', lines: [{ sku_code: code, quantity: 2 }] });
const f3 = await free(code);
console.log(JSON.stringify({ allotment: made.allotment_number, sku: code, free_before: f0, after_pick: f1, after_reduce: f2, after_move_back: f3, owed_card_picked: card?.picked ?? card, change: change && { was: change.was_total, now: change.now_total } }, null, 1));
