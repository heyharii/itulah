// Ops › Stock (/operations/stock): the owner tree PO / Unidentified / Unallotted /
// Allotted → Unpicked, Picked, Packed, Dispatch / Return stock / To supplier.
// Each test makes its own PO (run-unique tag) and proves the figure it reads
// through the cloud API.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, dcReturns, deliver, handOver, nudge, placePo, poNumbers, raiseReturn, rows, tag, waitFor, waitPo } from '../../support/rig.ts';
import { fleet, idn, makeOwnItem } from '../../support/inventory.ts';

type Screen = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const row = (screen: Screen, name: RegExp) => screen.getByRole('row', { name });

/**
 * Open an accordion of the tree and bring `needle` (a PO number) into view: in
 * the first five rows when it is there, else through "View all" and the list's
 * own search. Returns the locator of the row that names it.
 */
async function reveal(screen: Screen, group: string, searchLabel: string, needle: string) {
  const head = row(screen, new RegExp(`^${group}\\b`));
  // A row folds its detail only once the data behind it has arrived (aria-expanded appears with it).
  await expect(head).toHaveAttribute('aria-expanded', { timeout: 60_000 });
  await head.tap();
  const mine = row(screen, new RegExp(needle)).first();
  const all = screen.getByRole('button', { name: /^View all/ });
  // The accordion draws five rows; a sixth-and-later PO is in the list behind "View all".
  await expect.poll(async () => (await mine.isVisible()) || (await all.isVisible()), { timeout: 30_000 }).toBe(true);
  if (await mine.isVisible()) return mine;
  await all.tap();
  const dialog = screen.getByRole('dialog');
  await dialog.getByRole('textbox', searchLabel).fill(needle);
  const inList = dialog.getByRole('row', { name: new RegExp(needle) }).first();
  await expect(inList).toBeVisible({ timeout: 15_000 });
  return inList;
}

describe('Ops › Stock', { tags: ['inventory'] }, () => {
  test('the tree names every stage in the order goods travel', { session: 'nina', tags: ['inventory', 'smoke'] }, async ({ app, screen }) => {
    await app.open('/operations/stock');
    await expect(screen.getByRole('heading', 'Stock')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('tab', 'Stock')).toBeVisible();
    for (const head of ['Pool', 'On Hand', 'Seen', 'Last Count']) {
      await expect(screen.getByRole('columnheader', head)).toBeVisible();
    }
    // Missing is switched off (SHOW_MISSING = false): no second tab, no Missing row.
    await expect(screen.getByRole('tab', /^Missing/)).toBeHidden();
    const order = ['On order', 'Unidentified', 'Unallotted', 'Allotted', 'Unpicked', 'Picked', 'Packed', 'Dispatch', 'Return stock', 'To supplier', 'Over-delivery', 'Returns'];
    const labels = await screen.getByRole('row').allTextContents();
    const heads = order.map((name) => labels.findIndex((text: string) => text.startsWith(name)));
    for (const [i, name] of order.entries()) expect(heads[i], `${name} row`).toBeGreaterThanOrEqual(0);
    expect(heads, 'rows follow the goods').toEqual([...heads].sort((a, b) => a - b));
    await expect(row(screen, /^Total\b/)).toBeVisible();
  });

  test('an open PO is On order with its outstanding pieces, and opens its sheet', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    const ctx = await makeOwnItem(tag('IV'));
    const po = await placePo(ctx, 8, { notes: 'Uji Ops Stock on order' });
    await waitPo(po, { expected_stock_units: 8 });
    await app.open('/operations/stock');
    const mine = await reveal(screen, 'On order', 'Search On order', po);
    await expect(mine).toContainText(po);
    await expect(mine).toContainText(String(ctx.supplier.name).slice(0, 8));
    // The PO's outstanding figure is the row's figure.
    const n = await poNumbers(po);
    expect(n.outstanding_stock_units).toBe(8);
    await expect(mine).toContainText('8');
    await mine.tap();
    await expect(browser).toHaveURL(/order=/);
    await expect(screen.getByText(po).first()).toBeVisible();
  });

  test('a delivery the buyer accepted is Unidentified, by PO and article', { session: 'rina', tags: ['inventory'], timeout: 420_000 }, async ({ app, screen }) => {
    const t = tag('IV');
    const ctx = await makeOwnItem(t);
    const po = await placePo(ctx, 8, { notes: 'Uji Ops Stock unidentified' });
    await deliver(ctx, po, 8, { review: 'Accept' });
    await waitPo(po, { received_stock_units: 8 });
    // The receipt line waits in Cloud as unidentified until merchandising sets the article up.
    await waitFor(`${po} unidentified`, async () => {
      await nudge('dc', 'cloud');
      return rows(await as('cloud', 'rina').get('/api/v1/article-setups/unidentified')).find((r) => r.po_number === po);
    }, 180_000);
    await app.open('/operations/stock');
    const mine = await reveal(screen, 'Unidentified', 'Search Unidentified', po);
    await expect(mine).toContainText(po);
    await expect(mine).toContainText('8');
    // Its article stands under it with the pieces counted.
    await expect(screen.getByRole('row', { name: new RegExp(`Kaos Uji ${t}`) }).first()).toBeVisible({ timeout: 15_000 });
    // …and it is no longer owed: nothing outstanding on the order.
    expect((await poNumbers(po)).outstanding_stock_units).toBe(0);
  });

  test('pieces over the order become Over-delivery once the buyer raises the return, and leave when the DC hands them over', { session: 'rina', tags: ['inventory'], timeout: 480_000 }, async ({ app, screen }) => {
    const ctx = await makeOwnItem(tag('IV'));
    const po = await placePo(ctx, 8, { notes: 'Uji Ops Stock over-delivery' });
    await deliver(ctx, po, 12, { review: 'Accept' });
    await waitPo(po, { excess_stock_units: 4 });
    // Excess alone is not a return: nothing is Over-delivery until the buyer raises one.
    expect((rows(await as('cloud', 'rina').get('/api/v1/purchase-returns')) as any[]).filter((r) => r.po_number === po)).toHaveLength(0);
    await raiseReturn(po);
    const open = await waitFor(`${po} return at the DC`, async () => {
      await nudge('cloud', 'dc');
      return (await dcReturns(po))[0];
    }, 120_000);

    await app.open('/operations/stock');
    const over = await reveal(screen, 'Over-delivery', 'Search Over-delivery', po);
    await expect(over).toContainText('4');

    await handOver(open.return_id ?? open.id);
    await waitFor(`${po} return handed over`, async () => {
      const left = (await as('cloud', 'rina').get('/api/v1/purchase-returns?status=OPEN')).items.filter((r: any) => r.po_number === po);
      return left.length === 0;
    }, 120_000);
    await app.open('/operations/stock');
    await expect(row(screen, /^To supplier\b/)).toBeVisible({ timeout: 30_000 });
    await expect(row(screen, new RegExp(po))).toBeHidden();
  });

  test('the Unallotted row is the DC warehouse pool\'s on-hand figure the fleet read reports', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    // Other suites move the warehouse all the time, so read the screen and the API back to back and
    // reload until both name the same moment.
    await app.open('/operations/stock');
    await expect
      .poll(async () => {
        await browser.reload();
        const unallotted = row(screen, /^Unallotted\b/);
        await expect(unallotted).toBeVisible({ timeout: 30_000 });
        await expect(unallotted).toHaveText(/\d/, { timeout: 30_000 });
        const shown = (await unallotted.textContent()) ?? '';
        const pool = (await fleet()).find((p) => p.id === 'dc.warehouse' && p.authority?.included_in_fleet_total);
        return pool !== undefined && shown.includes(idn(pool.on_hand));
      }, { timeout: 120_000, interval: 500 })
      .toBe(true);
  });

  test('stage rows open a dialog with a Back path to the list they came from', { session: 'rina', tags: ['inventory'] }, async ({ app, screen }) => {
    await app.open('/operations/stock');
    await row(screen, /^Dispatch\b/).tap();
    const dialog = screen.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('Dispatch').first()).toBeVisible();
    await screen.getByRole('button', 'Close').tap();
    await expect(dialog).toBeHidden();
  });
});
