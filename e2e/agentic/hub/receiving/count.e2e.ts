// Ops › Receiving: the DC's blind count (nina).
import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, cancelPo, closeShort, nudge, poNumbers, rows, waitFor, waitPo } from '../../support/rig.ts';
import { countPo, dcCounts, newPo, openCount, review, typeCount, waitReceived } from '../../support/po.ts';
import { dcLine } from '../../support/rig.ts';

const code = (t: string) => `${t}-KAO`;

describe('Receiving list', () => {
  test('RCV-01 a new order is listed with its supplier, PO number, 1 item and "Count receive"', { session: 'nina', tags: ['receiving', 'smoke'] }, async ({ app, screen }) => {
    const { po } = await newPo(8);
    await dcLine(po);
    await app.open('/operations/intake');
    const row = screen.getByRole('row', { name: new RegExp(po) });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row).toContainText('Garmen Nusantara');
    await expect(row).toContainText('Count receive');
  });

  test('RCV-02 the search (?q=) narrows the list to the PO; a miss says "No orders match."', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { po } = await newPo(8);
    await dcLine(po);
    await app.open(`/operations/intake?q=${po}`);
    await expect(screen.getByRole('row', { name: new RegExp(po) })).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByRole('row', { name: /PO-\d{6}-\d{3}/ })).toHaveCount(1);
    await app.open('/operations/intake?q=ZZZ-none');
    await expect(screen.getByText('No orders match.')).toBeVisible({ timeout: 60_000 });
  });

  test('RCV-03 a cancelled order is not listed for counting', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { po } = await newPo(8);
    await dcLine(po);
    await cancelPo(po);
    await waitFor('cancel reaches the DC', async () => { await nudge('cloud', 'dc'); return !rows(await as('dc', 'nina').get('/api/v1/dc/purchase-orders?limit=500')).some((l) => l.po_number === po); });
    await app.open('/operations/intake');
    await expect(screen.getByRole('tab', /^Purchase orders/)).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByRole('row', { name: new RegExp(po) })).toBeHidden();
  });

  test('RCV-04 a closed-short order is no longer listed for counting', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Accept');
    await waitReceived(po, 5);
    await closeShort(po);
    await waitPo(po, { lifecycle: 'SHORT_RECEIVED' });
    await waitFor('closed short reaches the DC', async () => { await nudge('cloud', 'dc'); return !rows(await as('dc', 'nina').get('/api/v1/dc/purchase-orders?limit=500')).some((l) => l.po_number === po); });
    await app.open('/operations/intake');
    await expect(screen.getByRole('tab', /^Purchase orders/)).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByRole('row', { name: new RegExp(po) })).toBeHidden();
  });

  test('RCV-05 a partly received order stays listed and the sheet says how many are already in', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { t, ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Accept');
    await waitReceived(po, 5);
    await openCount(app, screen, po);
    await expect(screen.getByText(/5 already in/)).toBeVisible();
    await expect(screen.getByLabel(`Counted PCS of ${code(t)}`)).toBeVisible();
  });
});

describe('Receiving blind count', () => {
  test('RCV-10 the sheet never shows the ordered quantity and Submit count is disabled while nothing is typed', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { t, po } = await newPo(8);
    await dcLine(po);
    await openCount(app, screen, po);
    await expect(screen.getByText('Total Counted')).toBeVisible();
    await expect(screen.getByText('Not as Ordered')).toBeVisible();
    await expect(screen.getByText('Damaged or wrong items')).toBeVisible();
    await expect(screen.getByRole('button', 'Submit count')).toBeDisabled();
    await expect(screen.getByRole('dialog')).not.toContainText('8 pcs');
    await typeCount(screen, code(t), '3');
    await expect(screen.getByRole('button', 'Submit count')).toBeEnabled();
    await expect(screen.getByText('3 pcs').first()).toBeVisible();
  });

  test('RCV-11 counting exactly what was ordered receives the PO on its own', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { t, po } = await newPo(8);
    await dcLine(po);
    await openCount(app, screen, po);
    await typeCount(screen, code(t), '8');
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    await waitPo(po, { lifecycle: 'FULLY_RECEIVED', received_stock_units: 8 });
    const counts = await dcCounts(po);
    expect(counts.length === 0 || counts.every((c) => c.counted_quantity === 8)).toBe(true);
  });

  test('RCV-12 a short count waits for review (nothing received yet)', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { t, po } = await newPo(8);
    await dcLine(po);
    await openCount(app, screen, po);
    await typeCount(screen, code(t), '5');
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    const [c] = await waitFor('count at DC', async () => { const l = await dcCounts(po); return l.length ? l : null; }, 30_000, 1_000);
    expect(c.counted_quantity).toBe(5);
    expect(c.variance).toBe(-3);
    expect((await poNumbers(po)).received_stock_units).toBe(0);
  });

  test('RCV-13 an over count (11 of 8) waits for review with +3', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { t, po } = await newPo(8);
    await dcLine(po);
    await openCount(app, screen, po);
    await typeCount(screen, code(t), '11');
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    const [c] = await waitFor('count at DC', async () => { const l = await dcCounts(po); return l.length ? l : null; }, 30_000, 1_000);
    expect(c.counted_quantity).toBe(11);
    expect(c.variance).toBe(3);
  });

  test('RCV-14 the Not as Ordered figure travels with the count', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { t, po } = await newPo(8);
    await dcLine(po);
    await openCount(app, screen, po);
    await typeCount(screen, code(t), '8');
    await screen.getByPlaceholder('0').fill('3');
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    const [c] = await waitFor('count at DC', async () => { const l = await dcCounts(po); return l.length ? l : null; }, 30_000, 1_000);
    // the sheet's Counted is the good pieces; the wire count is good + Not as Ordered
    expect(c.counted_quantity).toBe(11);
    expect(c.wrong_quantity).toBe(3);
  });

  test('RCV-15 only wrong goods arrived: Not as Ordered with nothing counted', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { po } = await newPo(8);
    await dcLine(po);
    await openCount(app, screen, po);
    await screen.getByPlaceholder('0').fill('3');
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    const [c] = await waitFor('count at DC', async () => { const l = await dcCounts(po); return l.length ? l : null; }, 30_000, 1_000);
    expect(c.wrong_quantity).toBe(3);
    expect(c.counted_quantity).toBe(3); // nothing good: the count is the wrong pieces alone
  });

  test('RCV-16 a unit other than pieces is converted: 1 Lusin counts as 12 pieces', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { t, po } = await newPo(8);
    await dcLine(po);
    await openCount(app, screen, po);
    await screen.getByRole('combobox', `Unit counted for ${code(t)}`).tap();
    await screen.getByRole('option', 'Lusin').tap();
    await screen.getByLabel(`Counted LUSIN of ${code(t)}`).fill('1');
    await expect(screen.getByText('12 pcs').first()).toBeVisible();
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    const [c] = await waitFor('count at DC', async () => { const l = await dcCounts(po); return l.length ? l : null; }, 30_000, 1_000);
    expect(c.counted_quantity).toBe(12);
  });

  test('RCV-17 a second unit can be added to a line and removed again', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { t, po } = await newPo(8);
    await dcLine(po);
    await openCount(app, screen, po);
    await typeCount(screen, code(t), '5');
    await screen.getByRole('button', 'Another unit').tap();
    await expect(screen.getByRole('button', 'Remove this amount').first()).toBeVisible();
    await screen.getByRole('button', 'Remove this amount').first().tap();
    await expect(screen.getByRole('button', 'Remove this amount')).toBeHidden();
  });

  test('RCV-18 a decimal Not as Ordered figure is refused', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { t, po } = await newPo(8);
    await dcLine(po);
    await openCount(app, screen, po);
    await typeCount(screen, code(t), '8');
    await screen.getByPlaceholder('0').fill('2.5');
    await expect(screen.getByText('Must be a whole number of pieces')).toBeVisible();
    await expect(screen.getByRole('button', 'Submit count')).toBeDisabled();
  });

  test('RCV-19 a recounted order is listed as "Count again" with the buyer\'s reason, and an exact recount receives it', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { t, ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Recount', 40_000, 'Hitung ulang ya');
    await app.open('/operations/intake');
    const row = screen.getByRole('row', { name: new RegExp(po) });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row).toContainText('Count again');
    await expect(row).toContainText('Hitung ulang ya');
    await row.tap();
    await typeCount(screen, code(t), '8');
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    await waitPo(po, { lifecycle: 'FULLY_RECEIVED', received_stock_units: 8 });
  });

  test('RCV-20 once counted, the list shows the count and who counted it', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 5, 2);
    await app.open('/operations/intake');
    const row = screen.getByRole('row', { name: new RegExp(po) });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row).toContainText('3 pcs'); // 5 arrived, 2 of them not as ordered
    await expect(row).toContainText('+ 2 Not as Ordered');
    await expect(row).toContainText('Nina Oktaviani');
  });

  test('RCV-21 a counted sheet is read-only and offers Recall Count', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    test.skip(process.env.RIG_DC_HOSTING !== 'cloud', 'Recall is built only on the cloud-hosted warehouse; this rig has a separate DC node');
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 5);
    await app.open('/operations/intake');
    await screen.getByRole('row', { name: new RegExp(po) }).tap();
    await expect(screen.getByText('Counted by')).toBeVisible();
    await screen.getByRole('button', 'Recall Count').tap();
    await expect(screen.getByText('Recall this count?')).toBeVisible();
    await screen.getByRole('button', 'Recall Count').last().tap();
    await expect(screen.getByText(/Recalled/)).toBeVisible({ timeout: 30_000 });
  });

  test('RCV-22 counting every line as 0 (reject the whole lorry) is allowed', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    test.skip(process.env.RIG_DC_HOSTING !== 'cloud', 'a zero count is refused by the DC node; allowed only when the cloud hosts the warehouse');
    const { t, po } = await newPo(8);
    await dcLine(po);
    await openCount(app, screen, po);
    await typeCount(screen, code(t), '0');
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
  });

  test('RCV-23 on this rig an all-zero count is refused with the DC node\'s banner', { session: 'nina', tags: ['receiving'] }, async ({ app, screen }) => {
    test.skip(process.env.RIG_DC_HOSTING === 'cloud', 'the cloud-hosted warehouse allows it (RCV-22)');
    const { t, po } = await newPo(8);
    await dcLine(po);
    await openCount(app, screen, po);
    await typeCount(screen, code(t), '0');
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/a count of nothing is not a count; refuse the delivery instead/)).toBeVisible({ timeout: 30_000 });
  });

  test('RCV-24 rejecting a whole delivery has no hub button (API only)', { tags: ['receiving'] }, async () => {
    const { rejectDelivery } = await import('../../support/rig.ts');
    const { tag } = await import('../../support/rig.ts');
    const { makeItemFast } = await import('../../support/po.ts');
    const ctx = await makeItemFast(tag());
    const res = await rejectDelivery(ctx);
    expect(JSON.stringify(res)).toMatch(/REJECTED|receipt_id/);
  });
});
