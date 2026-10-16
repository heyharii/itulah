// Inventory › Counts (/inventory/counts): the book of official counts and the
// lifecycle DRAFT → ACTIVE → REVIEW → CLOSED.
//   · a count of a pool the cloud owns (store-c014/5/6 have no store node) runs
//     entirely in the hub: Activate, Submit, Approve;
//   · a count of a pool a DC node owns (dc.warehouse) is asked from the hub, walked
//     by the handheld at the DC (arranged here through the DC's API, as nina) and
//     reviewed + approved in the hub. Its scope names our own EPCs, so no other
//     suite's stock is ever counted.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, nudge, rows, tag, waitFor } from '../../support/rig.ts';
import {
  DC_WAREHOUSE,
  cloudCount,
  cloudCounts,
  closeOpenCounts,
  availability,
  dcMovements,
  dcCountSheet,
  healInventoryModule,
  signedIn,
  raiseCount,
  reason,
  submitAtDc,
  taggedStock,
  waitCountStatus,
  walkCount,
  type Tagged,
} from '../../support/inventory.ts';

type Screen = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Pick `option` in the Select labelled `field` (a desk popover: trigger, then the option). */
async function choose(screen: Screen, trigger: Screen, option: string | RegExp) {
  await trigger.tap();
  await screen.getByRole('option', option).tap();
}

describe('Counts: the book', { tags: ['inventory'] }, () => {
  test('INV-00 the Inventory module loads (a missing export took every /inventory screen down)', { session: 'rina', tags: ['inventory', 'smoke', 'bug'] }, async ({ app, screen }) => {
    // No healInventoryModule here on purpose: this is the app as shipped.
    await app.open('/inventory/counts');
    await expect(screen.getByRole('heading', 'Counts')).toBeVisible({ timeout: 60_000 });
  });

  test('the book lists counts with the columns, kinds and the DC-owned seeded count', { session: 'rina', tags: ['inventory', 'smoke'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/counts');
    await expect(screen.getByRole('heading', 'Counts')).toBeVisible({ timeout: 30_000 });
    for (const head of ['Count', 'Kind', 'Counted by', 'Status', 'Expected', 'Found', 'Difference', 'Opened', 'Closed']) {
      await expect(screen.getByRole('columnheader', head)).toBeVisible();
    }
    // The rig opened one cycle count of the DC warehouse; it is DC-owned, so "Counted by" says DC.
    const seeded = screen.getByRole('row', { name: /Opname siklus gudang DC/ });
    await expect(seeded).toBeVisible();
    await expect(seeded).toContainText('dc.warehouse');
    await expect(seeded).toContainText('DC');
    await expect(screen.getByRole('button', 'New count')).toBeVisible();
    await expect(screen.getByRole('textbox', 'Search counts')).toBeVisible();
  });

  test('searching narrows the book on the server and says so when nothing matches', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/counts');
    await expect(screen.getByRole('row', { name: /Opname siklus gudang DC/ })).toBeVisible({ timeout: 30_000 });
    const search = screen.getByRole('textbox', 'Search counts');
    await search.fill('zzzz-no-such-count');
    await expect(screen.getByText('Nothing matches.')).toBeVisible({ timeout: 15_000 });
    await expect(browser).toHaveURL(/q=zzzz-no-such-count/);
    await search.fill('Opname siklus');
    await expect(screen.getByRole('row', { name: /Opname siklus gudang DC/ })).toBeVisible({ timeout: 15_000 });
  });

  test('the views are the status filter, and each carries the server\'s own tally', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/counts');
    await expect(screen.getByRole('heading', 'Counts')).toBeVisible({ timeout: 30_000 });
    const facets = (await as('cloud', 'rina').get('/api/v1/inventory/counts?limit=1')).facets.statuses as { value: string; count: number }[];
    const n = (status: string) => facets.find((f) => f.value === status)?.count ?? 0;
    await screen.getByRole('button', 'All counts').tap();
    // Each view is named with its count (All counts has none).
    for (const [word, status] of [['Needs review', 'REVIEW'], ['Counting', 'ACTIVE'], ['Drafts', 'DRAFT'], ['Closed', 'CLOSED']] as const) {
      await expect(screen.getByRole('menuitem', `${word} ${n(status)}`)).toBeVisible();
    }
    await screen.getByRole('menuitem', `Counting ${n('ACTIVE')}`).tap();
    await expect(browser).toHaveURL(/count-status=ACTIVE/);
    await expect(screen.getByRole('row', { name: /Opname siklus gudang DC/ })).toBeVisible({ timeout: 15_000 });
  });

  test('New count: Submit waits for a pool and a reason, and a targeted count asks for the tags', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/counts');
    await screen.getByRole('button', 'New count').tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', 'New count')).toBeVisible({ timeout: 15_000 });
    const submit = sheet.getByRole('button', 'Submit');
    await expect(submit).toBeDisabled();
    await sheet.getByRole('textbox', 'Reason (required)').fill(reason(tag('IV'), 'validasi'));
    await expect(submit).toBeDisabled(); // still no pool
    await choose(screen, sheet.getByRole('combobox', 'Pool (required)'), /store-c015 · Warehouse/);
    await expect(submit).toBeEnabled();
    await choose(screen, sheet.getByRole('combobox', 'Kind'), 'Targeted');
    await expect(sheet.getByRole('textbox', 'Tags to count (required)')).toBeVisible();
    await expect(submit).toBeDisabled(); // a targeted count needs its tags
    await sheet.getByRole('textbox', 'Tags to count (required)').fill('A10000000000000000000001');
    await expect(submit).toBeEnabled();
    // Nothing was written by looking.
    expect((await cloudCounts('validasi')).length).toBe(0);
  });

  test('the pool picker offers only pools the cloud may write to (never a DC-owned shelf)', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/counts');
    await expect(screen.getByRole('button', 'New count')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('button', 'New count').tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('combobox', 'Pool (required)').tap();
    await expect(screen.getByRole('option', /store-c015 · Warehouse/)).toBeVisible({ timeout: 15_000 });
    // dc.warehouse is owned by the DC node (OWNER_NODE_ONLY): a count of it is asked from Stock, not here.
    await expect(screen.getByRole('option', /^dc · Warehouse$/)).toBeHidden();
  });
});

describe('Counts: a pool the cloud owns, start to finish in the hub', { serial: true, tags: ['inventory'] }, () => {
  const t = tag('IV');
  const why = reason(t, 'toko Cirebon');
  let id = '';

  test('a new count is a Draft in the book', { tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await signedIn(app, browser);
    await closeOpenCounts('store-c016');
    await app.open('/inventory/counts');
    await screen.getByRole('button', 'New count').tap();
    const sheet = screen.getByRole('dialog');
    await choose(screen, sheet.getByRole('combobox', 'Pool (required)'), /store-c016 · Warehouse/);
    await sheet.getByRole('textbox', 'Reason (required)').fill(why);
    await sheet.getByRole('button', 'Submit').tap();
    const made = await waitFor(`count ${why}`, async () => (await cloudCounts(t))[0], 30_000, 1_000);
    id = made.id;
    expect(made).toMatchObject({ status: 'DRAFT', kind: 'FULL', pool_id: 'store-c016.warehouse', site_id: 'store-c016', created_by: 'rina' });
    // The book finds it by its reason, as Draft.
    await browser.keyboard.press('Escape');
    await screen.getByRole('textbox', 'Search counts').fill(t);
    const mine = screen.getByRole('row', { name: new RegExp(t) });
    await expect(mine).toBeVisible({ timeout: 20_000 });
    await expect(mine).toContainText('Draft');
    await expect(mine).toContainText('store-c016.warehouse');
    await expect(mine).toContainText('Cloud'.toUpperCase());
  });

  test('Activate freezes it as Counting, here', { tags: ['inventory'] }, async ({ app, screen, browser }) => {
    test.skip(id === '', 'needs the draft from the previous step');
    await healInventoryModule(browser);
    await signedIn(app, browser);
    await app.open(`/inventory/counts?count=${id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', why)).toBeVisible({ timeout: 30_000 });
    await expect(sheet.getByText('Counted here')).toBeVisible();
    await expect(sheet.getByText('Everything in the pool')).toBeVisible();
    await expect(sheet.getByText('No lines yet.')).toBeVisible();
    await sheet.getByRole('button', 'Activate').tap();
    await expect(sheet.getByRole('button', 'Activate')).toBeHidden({ timeout: 20_000 });
    expect((await cloudCount(id)).status).toBe('ACTIVE');
    expect((await cloudCount(id)).execution_authority).toBe('CLOUD');
    // While it is being counted the only way on is Submit.
    await expect(sheet.getByRole('button', 'Submit').last()).toBeEnabled();
  });

  test('Submit sends it to review, Approve closes it and records the close time', { tags: ['inventory'] }, async ({ app, screen, browser }) => {
    test.skip(id === '', 'needs the active count');
    await healInventoryModule(browser);
    await signedIn(app, browser);
    await app.open(`/inventory/counts?count=${id}`);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('button', 'Submit').last().tap();
    await expect(sheet.getByRole('button', 'Approve')).toBeVisible({ timeout: 20_000 });
    expect((await cloudCount(id)).status).toBe('REVIEW');
    await sheet.getByRole('button', 'Approve').tap();
    await expect(sheet.getByRole('button', 'Approve')).toBeHidden({ timeout: 20_000 });
    const closed = await waitCountStatus(id, 'CLOSED', 60_000);
    expect(closed.closed_at).toBeTruthy();
    // Closed counts offer nothing more.
    for (const name of ['Activate', 'Submit', 'Approve']) await expect(sheet.getByRole('button', name)).toBeHidden();
    await browser.keyboard.press('Escape');
    // The Closed view finds it.
    await app.open(`/inventory/counts?count-status=CLOSED&q=${t}`);
    await expect(screen.getByRole('row', { name: new RegExp(t) })).toContainText('Closed', { timeout: 20_000 });
  });
});

describe('Counts: a DC-owned pool, asked in the hub, walked at the DC, approved in the hub', { serial: true, tags: ['inventory'] }, () => {
  let stock: Tagged;
  let countId = '';
  let missed = '';

  test('arrange: tagged stock of our own and a targeted count of its four SKUs', { tags: ['inventory'], timeout: 900_000 }, async () => {
    stock = await taggedStock(8);
    const made = await raiseCount({ site_id: 'dc', pool_id: DC_WAREHOUSE, kind: 'TARGETED', reason: reason(stock.t, 'gudang DC'), sku_ids: stock.skus.map((s) => s.sku_id) });
    countId = made.id;
    const sheet = await dcCountSheet(countId);
    expect(sheet.summary.status).toBe('ACTIVE');
    // Every piece on the sheet is one of ours: the eight pieces of the article's four SKUs.
    const lines = sheet.lines as { epc: string; sku_code: string }[];
    expect(lines).toHaveLength(8);
    for (const line of lines) expect(stock.skus.map((s) => s.sku_code)).toContain(line.sku_code);
    // The handheld finds seven of the eight.
    missed = lines[7]!.epc;
    await walkCount(countId, lines.slice(0, 7));
  });

  test('while the DC walks, the hub shows it as Counted by the DC with nothing to press', { tags: ['inventory'] }, async ({ app, screen, browser }) => {
    test.skip(countId === '', 'needs the count');
    await healInventoryModule(browser);
    await signedIn(app, browser);
    await app.open(`/inventory/counts?count=${countId}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByText('Counted by the DC')).toBeVisible({ timeout: 30_000 });
    await expect(sheet.getByText('Owner')).toBeVisible();
    await expect(sheet.getByText('Scope')).toBeVisible();
    for (const name of ['Activate', 'Submit', 'Approve']) await expect(sheet.getByRole('button', name)).toBeHidden();
  });

  test('once the DC submits, the hub reviews it: book, counted and what approving will do', { tags: ['inventory'], timeout: 300_000 }, async ({ app, screen, browser }) => {
    test.skip(countId === '', 'needs the count');
    await submitAtDc(countId);
    await waitCountStatus(countId, 'REVIEW');
    await healInventoryModule(browser);
    await signedIn(app, browser);
    await app.open(`/inventory/counts?count=${countId}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('button', 'Approve')).toBeVisible({ timeout: 30_000 });
    // Totals ladder: 8 expected, 7 found, one short.
    await expect(sheet.getByText('Difference')).toBeVisible();
    await expect(sheet.getByText('-1').first()).toBeVisible();
    // Per SKU: the one SKU that lost a piece reads "1 short" (Missing is switched off, so it is not "to Missing").
    await expect(sheet.getByText('1 short')).toBeVisible();
    await expect(sheet.getByText('Same').first()).toBeVisible();
    await expect(sheet.getByText(stock.article).first()).toBeVisible();
    // Three of the four SKUs are as booked.
    await expect(sheet.getByRole('row', { name: /Same$/ })).toHaveCount(3);
  });

  test('Approve asks the DC to book the shortage; the count closes when the DC has applied it', { tags: ['inventory'], timeout: 400_000 }, async ({ app, screen, browser }) => {
    test.skip(countId === '', 'needs the count in review');
    await healInventoryModule(browser);
    await signedIn(app, browser);
    await app.open(`/inventory/counts?count=${countId}`);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('button', 'Approve').tap();
    // A DC-owned count does not close on approval: it asks for a movement and stays in review until the DC answers.
    await expect(sheet.getByText(/^Movement /)).toBeVisible({ timeout: 30_000 });
    const closed = await waitCountStatus(countId, 'CLOSED', 240_000);
    expect(closed.edge_adjustment_status).toBe('APPLIED');
    // The open sheet does not poll; opening the count again reads the DC's answer.
    await app.open(`/inventory/counts?count=${countId}`);
    await expect(sheet.getByText('Movement Applied')).toBeVisible({ timeout: 30_000 });
    for (const name of ['Activate', 'Submit', 'Approve']) await expect(sheet.getByRole('button', name)).toBeHidden();
    // The DC's ledger says the same thing: the piece nobody found moved from on_hand to missing.
    const shortage = (await dcMovements('', 500)).find((m) => m.cause === 'COUNT_SHORTAGE' && m.reference_id === countId);
    expect(shortage, 'COUNT_SHORTAGE posting for the piece nobody found').toMatchObject({
      epc: missed,
      from: `${DC_WAREHOUSE}:on_hand`,
      to: `${DC_WAREHOUSE}:missing`,
      quantity: 1,
    });
    // And the cloud's availability of our SKUs (read from the DC's fact positions) follows: 7 on hand, 1 missing.
    const mine = await waitFor('availability after the shortage', async () => {
      await nudge('dc', 'cloud');
      const lines = await availability(DC_WAREHOUSE, stock.t);
      const missing = lines.reduce((sum, r) => sum + (r.missing_qty ?? 0), 0);
      return missing === 1 ? lines : null;
    }, 120_000, 3_000);
    expect(mine.reduce((sum, r) => sum + r.on_hand_qty, 0)).toBe(7);
  });

  test('two things the finished count must show: its scope in SKUs, and its shortage as an Exception', { tags: ['inventory', 'bug'], timeout: 300_000 }, async ({ app, screen, browser }) => {
    test.skip(countId === '', 'needs the closed count');
    await healInventoryModule(browser);
    await signedIn(app, browser);
    // 1. A count scoped to four SKUs says so (the sheet reads sku_codes/epcs, which the stored scope — sku_ids — never fills,
    //    so it reads "Everything in the pool").
    await app.open(`/inventory/counts?count=${countId}`);
    await expect(screen.getByRole('dialog').getByText('Scope')).toBeVisible({ timeout: 30_000 });
    expect.soft(await screen.getByRole('dialog').textContent(), 'scope of a count of four SKUs').toContain('4 SKUs');
    // 2. The shortage it booked waits for a person in the Exceptions inbox. (The cloud's missing book must know the piece the DC booked.)
    await app.open('/inventory/exceptions');
    await screen.getByRole('textbox').fill(stock.t);
    const mine = screen.getByRole('button', new RegExp(stock.article));
    await expect.soft(mine).toBeVisible({ timeout: 30_000 });
    await expect.soft(mine).toContainText('-1');
    await expect.soft(mine).toContainText('Missing');
  });
});
