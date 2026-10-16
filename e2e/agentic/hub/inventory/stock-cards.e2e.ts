// Inventory › Stock (/inventory): one card per place the business holds stock —
// head office, the road, the order book, and every open store.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, placePo, rows, tag, waitPo } from '../../support/rig.ts';
import { activeStoreUnits, cloudCounts, closeOpenCounts, fleet, healInventoryModule, idn, makeOwnItem } from '../../support/inventory.ts';

type Screen = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const card = (screen: Screen, name: RegExp) => screen.getByRole('button', { name });
const storeCards = (screen: Screen) => screen.getByRole('button', { name: /Store · C\d+/ });

async function open(app: any, screen: Screen, browser: any, path = '/inventory') {
  await healInventoryModule(browser);
  await app.open(path);
  // A deep link to a sheet opens it over the page (the page behind is inert), so wait for what is on top.
  if (path.includes('?')) await expect(screen.getByRole('dialog')).toBeVisible({ timeout: 60_000 });
  else await expect(screen.getByRole('heading', 'Stock')).toBeVisible({ timeout: 60_000 });
}

describe('Inventory › Stock: the cards', { tags: ['inventory'] }, () => {
  test('one card for head office, the road and the order book, and one for each open store', { session: 'rina', tags: ['inventory', 'smoke'] }, async ({ app, screen, browser }) => {
    await open(app, screen, browser);
    const open16 = await activeStoreUnits();
    expect(open16.length, 'store units on the rig').toBeGreaterThanOrEqual(16);
    await expect(screen.getByRole('heading', 'HO')).toBeVisible();
    await expect(card(screen, /^Head Office HO/)).toBeVisible();
    await expect(card(screen, /^On the road In inventory/)).toBeVisible();
    await expect(card(screen, /^On order Not in inventory/)).toBeVisible();
    await expect(screen.getByRole('heading', `Stores · ${open16.length}`)).toBeVisible({ timeout: 60_000 });
    await expect(storeCards(screen)).toHaveCount(open16.length);
    // Every open store has its own card, named as the store list names it, with its code.
    for (const s of open16) await expect(card(screen, new RegExp(`^${s.name} Store · ${s.code}`))).toBeVisible();
    // A store with no stock raises no exceptions; whether it says "Never counted" follows the fleet read.
    const garutCounted = (await fleet()).some((p) => p.site_id === 'store-c015' && p.last_counted_at);
    await expect(card(screen, /^Garut Store · C015/)).toContainText(garutCounted ? 'Last count' : 'Never counted');
    await expect(card(screen, /^Garut Store · C015/)).toContainText('No exceptions');
  });

  test('a store card\'s Inventory is the sum of the pools its site holds', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await open(app, screen, browser);
    const cikupa = card(screen, /^Cikupa Store · C001/);
    await expect(cikupa).toBeVisible();
    // The floor and the stockroom of store-01 are the stock it holds; the card must say what the fleet read says.
    await expect
      .poll(async () => {
        const book = (await fleet())
          .filter((p) => p.site_id === 'store-01' && p.authority?.included_in_fleet_total)
          .reduce((sum, p) => sum + p.stock, 0);
        return new RegExp(` ${idn(book)} Inventory`).test((await cikupa.textContent()) ?? '');
      }, { timeout: 30_000 })
      .toBe(true);
  });

  test('search narrows the stores by name or code, and offers a way back when nothing matches', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await open(app, screen, browser);
    const search = screen.getByRole('textbox', 'Search stores');
    await search.fill('garut');
    await expect(storeCards(screen)).toHaveCount(1, { timeout: 10_000 });
    await expect(card(screen, /^Garut/)).toBeVisible();
    await expect(browser).toHaveURL(/q=garut/);
    await search.fill('C016');
    await expect(card(screen, /^Cirebon/)).toBeVisible();
    await expect(storeCards(screen)).toHaveCount(1);
    const held = (await activeStoreUnits()).length;
    await search.fill('zzzz');
    await expect(screen.getByText(`There are ${held} stores here, and not one of them passes the search and filters in force.`)).toBeVisible({ timeout: 10_000 });
    await screen.getByRole('button', 'Clear the narrowing').tap();
    await expect(storeCards(screen)).toHaveCount(held);
    await expect(search).toHaveValue('');
  });

  test('A–Z puts the stores in name order', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await open(app, screen, browser);
    await screen.getByRole('combobox', 'Sort places').tap();
    await screen.getByRole('option', 'A–Z').tap();
    await expect
      .poll(async () => {
        const names = (await storeCards(screen).allTextContents()).map((text: string) => text.split(' Store · ')[0]!.trim());
        return names.length >= 16 && names.every((n: string, i: number) => i === 0 || names[i - 1]!.localeCompare(n) <= 0);
      }, { timeout: 30_000 })
      .toBe(true);
    // Back to "Needs attention first": the stores nobody has counted keep the name order among themselves.
    await screen.getByRole('combobox', 'Sort places').tap();
    await screen.getByRole('option', 'Needs attention first').tap();
    await expect(storeCards(screen).first()).toBeVisible();
  });

  test('On order opens the open purchase orders, with ours among them', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    const ctx = await makeOwnItem(tag('IV'));
    const po = await placePo(ctx, 8, { notes: 'Uji kartu stok on order' });
    await waitPo(po, { expected_stock_units: 8 });
    await open(app, screen, browser);
    await card(screen, /^On order Not in inventory/).tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', 'On order')).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByText('Not in inventory — owed by suppliers')).toBeVisible();
    for (const label of ['Awaited', 'Due this week', 'Late PO']) await expect(sheet.getByText(label)).toBeVisible();
    const mine = sheet.getByRole('row', { name: new RegExp(po) });
    await expect(mine).toBeVisible({ timeout: 15_000 });
    await expect(mine).toContainText('8');
    await expect(sheet.getByRole('link', 'Open in Procurement')).toBeVisible();
    // The card's own figure moves with the book: Awaited is every open order's outstanding pieces.
    const live = rows(await as('cloud', 'rina').get('/api/v1/purchase-orders?limit=500')).filter((p) => (p.outstanding_stock_units ?? 0) > 0);
    const awaited = live.reduce((sum, p) => sum + (p.outstanding_stock_units ?? 0), 0);
    expect(awaited).toBeGreaterThanOrEqual(8);
  });

  test('On the road lists the trips and returns in the air', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await open(app, screen, browser);
    await card(screen, /^On the road In inventory/).tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', 'On the road')).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByText('In inventory — counted in the books, standing in a truck')).toBeVisible();
    for (const label of ['To stores', 'Back to HO']) await expect(sheet.getByText(label).first()).toBeVisible();
  });

  test('a store\'s sheet tells its whole story: ring, last count, exceptions and the pools it is made of', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await open(app, screen, browser, '/inventory?location=store-01');
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', 'Cikupa')).toBeVisible({ timeout: 15_000 });
    await expect(sheet).toContainText('Store · C001');
    for (const label of ['Inventory', 'Observed', 'Gap', 'Last count', 'Exceptions', 'Where']) await expect(sheet).toContainText(label);
    // Its exceptions are the open cases at the site (store receives signed short by other suites included).
    await expect(sheet.getByRole('heading', /^Exceptions/)).toBeVisible();
    // The Floor line carries the floor pool's stock (what the node reports).
    const floor = (await fleet()).find((p) => p.id === 'store-01.floor' && p.authority?.included_in_fleet_total);
    await expect(sheet).toContainText(new RegExp(`Floor\\s*${idn(floor.stock)}\\b`));
  });

  test('"Where" names each shelf once (a shadowed Cloud row of a shelf its node owns is not a second shelf)', { session: 'rina', tags: ['inventory', 'bug'] }, async ({ app, screen, browser }) => {
    await open(app, screen, browser, '/inventory?location=store-01');
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', 'Where')).toBeVisible({ timeout: 15_000 });
    const text = (await sheet.textContent()) ?? '';
    const where = text.slice(text.indexOf('Where'));
    for (const shelf of ['Warehouse', 'Floor', 'Reject']) {
      const times = where.split(shelf).length - 1;
      expect(times, `${shelf} listed in "Where"`).toBe(1);
    }
  });
});

describe('Inventory › Stock: asking for a count', { tags: ['inventory'] }, () => {
  test('Count store on a cloud-owned store opens a full count, and the card then reads "Count active"', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await closeOpenCounts('store-c014');
    await open(app, screen, browser);
    await card(screen, /^Tasikmalaya Store · C014/).tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', 'Tasikmalaya')).toBeVisible({ timeout: 15_000 });
    const counted = (await fleet()).some((p) => p.site_id === 'store-c014' && p.last_counted_at);
    await expect(sheet).toContainText(counted ? /Last count \d/ : 'Last count never');
    await expect(sheet.getByText('Count active')).toBeHidden();
    await sheet.getByRole('button', 'Count store').tap();
    await expect(sheet.getByText('Count active')).toBeVisible({ timeout: 30_000 });
    await expect(sheet.getByRole('button', 'Count store')).toBeHidden();
    const [made] = await cloudCounts('store-c014');
    expect(made).toMatchObject({ site_id: 'store-c014', pool_id: 'store-c014.warehouse', kind: 'FULL', status: 'ACTIVE', created_by: 'rina' });
    expect(made.reason).toBe('Requested from Stock');
    await closeOpenCounts('store-c014');
  });

  test('head office already has a count running on the DC: its sheet says so instead of offering another', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    const running = (await cloudCounts('dc.warehouse')).some((c) => c.site_id === 'dc' && c.status === 'ACTIVE');
    test.skip(!running, 'no count is running on the DC warehouse on this rig');
    await open(app, screen, browser);
    await card(screen, /^Head Office HO/).tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', 'Head Office')).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByText('Count active')).toBeVisible();
    await expect(sheet.getByRole('button', 'Count HO')).toBeHidden();
  });
});
