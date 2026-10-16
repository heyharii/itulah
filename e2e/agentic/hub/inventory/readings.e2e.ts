// The readings of Inventory: On Hand & Shortfall (availability), Pools, Movements,
// Exceptions. The numbers are proven against the cloud's own API; the stock a
// test reads is its own tagged article.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, nudge, rows, waitFor } from '../../support/rig.ts';
import { DC_WAREHOUSE, availability, fleet, healInventoryModule, idn, signedIn, taggedStock, type Tagged } from '../../support/inventory.ts';

type Screen = any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('On Hand & Shortfall', { serial: true, tags: ['inventory'] }, () => {
  let stock: Tagged;

  test('arrange: tagged stock of our own in dc.warehouse', { tags: ['inventory'], timeout: 900_000 }, async () => {
    stock = await taggedStock(8);
    // The cloud reads the DC's pieces from the fact positions the DC syncs up.
    const mine = await waitFor(`${stock.t} in the cloud's availability`, async () => {
      await nudge('dc', 'cloud');
      const lines = await availability(DC_WAREHOUSE, stock!.t);
      return lines.length === 4 && lines.reduce((sum, r) => sum + r.stock_qty, 0) === 8 ? lines : null;
    }, 180_000, 3_000);
    expect(mine).toHaveLength(4);
  });

  test('searching the warehouse by our tag lists exactly our SKUs with the API\'s figures', { tags: ['inventory'] }, async ({ app, screen, browser }) => {
    test.skip(!stock, 'needs the stock');
    await healInventoryModule(browser);
    await signedIn(app, browser);
    await app.open('/inventory/availability');
    await expect(screen.getByRole('heading', 'On Hand & Shortfall')).toBeVisible({ timeout: 30_000 });
    // The pool opens on dc.warehouse and says which place it reads.
    await expect(screen.getByText('dc.warehouse:on_hand')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText('Stock + Shortfall = On Hand + Allotted + Missing')).toBeVisible();
    for (const head of ['Article', 'SKU', 'Variant', 'Division', 'Stock', 'Allotted', 'On Hand']) {
      await expect(screen.getByRole('columnheader', head)).toBeVisible();
    }
    await screen.getByRole('textbox').fill(stock.t);
    const api = await availability(DC_WAREHOUSE, stock.t);
    await expect(screen.getByRole('row', { name: new RegExp(`Kaos Uji ${stock.t}`) })).toHaveCount(api.length, { timeout: 20_000 });
    for (const sku of api) {
      const line = screen.getByRole('row', { name: new RegExp(sku.sku_code) });
      await expect(line).toContainText(`Kaos Uji ${stock.t}`);
      await expect(line).toContainText(`${idn(sku.stock_qty)} pcs`);
      await expect(line).toContainText(String(sku.division_code));
    }
    await expect(screen.getByText(`${api.length} SKUs`)).toBeVisible();
  });

  test('Over-promised keeps only SKUs promised beyond what the pool holds — none of ours is', { tags: ['inventory'] }, async ({ app, screen, browser }) => {
    test.skip(!stock, 'needs the stock');
    await healInventoryModule(browser);
    await signedIn(app, browser);
    await app.open('/inventory/availability');
    await expect(screen.getByText('dc.warehouse:on_hand')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('textbox').fill(stock.t);
    await expect(screen.getByRole('row', { name: new RegExp(stock.t) }).first()).toBeVisible({ timeout: 20_000 });
    await screen.getByRole('button', 'Over-promised').tap();
    await expect(screen.getByText(`Nothing in this pool matches “${stock.t}”.`)).toBeVisible({ timeout: 20_000 });
    await screen.getByRole('button', 'Every SKU').tap();
    await expect(screen.getByRole('row', { name: new RegExp(stock.t) }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('a search that matches nothing says what it looked for', { tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await signedIn(app, browser);
    await app.open('/inventory/availability');
    await expect(screen.getByText('dc.warehouse:on_hand')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('textbox').fill('zzqqxx');
    await expect(screen.getByText('Nothing in this pool matches “zzqqxx”.')).toBeVisible({ timeout: 20_000 });
  });

  test('another pool can be read: the store-01 floor names its own place', { tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await signedIn(app, browser);
    await app.open('/inventory/availability');
    await expect(screen.getByText('dc.warehouse:on_hand')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('combobox').first().tap();
    await screen.getByRole('option', /store-01 · Floor/).first().tap();
    await expect(screen.getByText('store-01.floor:on_hand')).toBeVisible({ timeout: 20_000 });
  });

  test('the pool picker names each shelf once (a shelf its node owns is not offered again as a shadowed Cloud row)', { tags: ['inventory', 'bug'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await signedIn(app, browser);
    await app.open('/inventory/availability');
    await expect(screen.getByText('dc.warehouse:on_hand')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('combobox').first().tap();
    await expect(screen.getByRole('option', /store-01 · Floor/).first()).toBeVisible({ timeout: 15_000 });
    const labels: string[] = await screen.getByRole('option').allTextContents();
    const twice = labels.filter((label, i) => labels.indexOf(label) !== i);
    expect(twice, 'options listed more than once').toEqual([]);
  });
});

describe('Pools', { tags: ['inventory'] }, () => {
  test('sites are rows that unfold into the pools they hold, and the fleet read is what they add up', { session: 'rina', tags: ['inventory', 'smoke'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/pools');
    await expect(screen.getByRole('heading', 'Pools')).toBeVisible({ timeout: 30_000 });
    for (const head of ['Pool', 'Kind', 'Stock', 'On Hand', 'Allotted', 'Observed', 'Last Count']) {
      await expect(screen.getByRole('columnheader', head)).toBeVisible();
    }
    const dc = screen.getByRole('row', { name: /^Expand DC\b/ });
    await expect(dc).toBeVisible({ timeout: 30_000 });
    // The DC row is the sum of the pools the fleet counts at its site.
    await expect
      .poll(async () => {
        const book = (await fleet())
          .filter((p) => p.site_id === 'dc' && !p.is_rollup && p.authority?.included_in_fleet_total)
          .reduce((sum, p) => sum + p.stock, 0);
        return ((await dc.textContent()) ?? '').includes(`${idn(book)} pcs`);
      }, { timeout: 30_000 })
      .toBe(true);
    await screen.getByRole('button', 'Expand DC').tap();
    await expect(screen.getByRole('row', { name: /^Warehouse\b/ }).first()).toBeVisible({ timeout: 10_000 });
    await expect(screen.getByText(/^Observations counted over the last \d+h · confirmed lost measured over \d+ days$/)).toBeVisible();
  });

  test('search flattens the tree so a pool is found without unfolding anything', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/pools');
    await expect(screen.getByRole('row', { name: /^Expand DC\b/ })).toBeVisible({ timeout: 30_000 });
    // The DC has no Floor; every store does. A matching leaf keeps only its own site.
    await screen.getByRole('textbox', 'Search pools').fill('Floor');
    await expect(screen.getByRole('row', { name: /^Expand DC\b/ })).toBeHidden({ timeout: 10_000 });
    await expect(screen.getByRole('row', { name: /^Expand Store 01\b/ })).toBeVisible();
    await screen.getByRole('textbox', 'Search pools').fill('zzzz');
    await expect(screen.getByRole('row', { name: /^Expand Store 01\b/ })).toBeHidden({ timeout: 10_000 });
    await expect(screen.getByRole('row', { name: /^Expand DC\b/ })).toBeHidden();
  });

  test('a pool\'s page: its kind and code, and a placement correction that needs a subject, a place, a reason and evidence', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/pools?pool=store-c015.warehouse');
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', 'Warehouse')).toBeVisible({ timeout: 30_000 });
    await expect(sheet.getByText('WAREHOUSE').first()).toBeVisible();
    for (const term of ['Site', 'Stock', 'On hand', 'Allotted', 'Seen', 'Confirmed lost', 'Confirmed lost rate']) {
      await expect(sheet.getByText(term).first()).toBeVisible();
    }
    await expect(sheet.getByText('Nothing sits in this pool.')).toBeVisible();
    await expect(sheet.getByRole('heading', 'Correct a placement')).toBeVisible();
    const post = sheet.getByRole('button', 'Correct placement');
    await expect(post).toBeDisabled();
    await sheet.getByRole('textbox', 'Reason (required)').fill('Salah rak');
    await sheet.getByRole('textbox', /^Evidence \(required\)/).fill('Catatan uji');
    // Without a subject picked from Holding it still cannot post.
    await expect(post).toBeDisabled();
    // The place picker never offers the pool itself.
    await sheet.getByRole('combobox', 'Place (required)').tap();
    await expect(screen.getByRole('option', /store-c015 · Warehouse/)).toBeHidden();
    await expect(screen.getByRole('option', /store-c015 · Floor/)).toBeVisible();
  });

  test('the side panel counts sites, pools, never-counted and disputed', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/pools');
    const panel = screen.getByRole('complementary', 'Filters');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    for (const label of ['Sites', 'Pools', 'Never counted', 'Disputed']) await expect(panel.getByText(label)).toBeVisible();
  });
});

describe('Movements', { tags: ['inventory'] }, () => {
  test('the ledger screen reads the cloud ledger: its total is the API\'s', { session: 'rina', tags: ['inventory', 'smoke'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/movements');
    await expect(screen.getByRole('heading', 'Movements')).toBeVisible({ timeout: 30_000 });
    const total = (await as('cloud', 'rina').get('/api/v1/inventory/movements?limit=1')).total as number;
    if (total === 0) {
      await expect(screen.getByText('Nothing has been posted to this ledger yet.')).toBeVisible({ timeout: 20_000 });
    } else {
      await expect(screen.getByRole('columnheader', 'Route')).toBeVisible({ timeout: 20_000 });
      for (const head of ['Date', 'Action', 'Route', 'SKU', 'Tag', 'Quantity', 'Posted by']) {
        await expect(screen.getByRole('columnheader', head)).toBeVisible();
      }
    }
    const panel = screen.getByRole('complementary', 'Filters');
    await expect(panel.getByText('Postings')).toBeVisible();
    await expect(panel.getByText('Loaded')).toBeVisible();
    for (const field of ['Pool', 'Action', 'Posted by']) await expect(panel.getByRole('button', field)).toBeVisible();
  });

  test('a search with no postings behind it is not mistaken for an empty ledger', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/movements');
    await expect(screen.getByRole('heading', 'Movements')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('textbox', 'Search movements').fill('zzzz-no-such-sku');
    await expect(screen.getByText('No movement matches what you asked for.')).toBeVisible({ timeout: 20_000 });
    await expect(browser).toHaveURL(/q=zzzz-no-such-sku/);
  });

  test('a delivery received at the DC is a posting in the ledger Movements reads', { session: 'rina', tags: ['inventory'], timeout: 600_000 }, async ({ app, screen, browser }) => {
    test.skip(process.env.RIG_DC_HOSTING !== 'cloud', 'needs the cloud-hosted DC: on this rig the DC is its own node and the cloud ledger holds none of its postings');
    const stock = await taggedStock(8);
    await healInventoryModule(browser);
    await app.open(`/inventory/movements?q=${stock.t}`);
    await expect(screen.getByRole('row', { name: /Opening/ }).first()).toBeVisible({ timeout: 30_000 });
  });
});

describe('Exceptions', { tags: ['inventory'] }, () => {
  /** The cases the live feeds hold now: the cloud's missing book plus stores' short receipts. */
  async function openCases() {
    const cloud = as('cloud', 'rina');
    const missing = rows(await cloud.get('/api/v1/inventory/missing?limit=200'));
    const since = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000 - 30 * 86_400_000).toISOString();
    const gaps = rows(await cloud.get(`/api/v1/inventory/shipments/received?since=${since}`)).filter((g) => g.open_gap_qty > 0);
    return missing.length + gaps.length;
  }

  test('the inbox counts the cases the feeds hold, and says so when there are none', { session: 'rina', tags: ['inventory', 'smoke'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/exceptions');
    await expect(screen.getByRole('heading', 'Exceptions')).toBeVisible({ timeout: 30_000 });
    const n = await openCases();
    await expect(screen.getByText(`${n} cases`)).toBeVisible({ timeout: 20_000 });
    if (n === 0) await expect(screen.getByText('Nothing here').first()).toBeVisible();
    // The sidebar row carries the same number (and no badge at all for none).
    const nav = screen.getByRole('link', { name: n === 0 ? /^Exceptions$/ : new RegExp(`^Exceptions ${n}$`) });
    await expect(nav).toBeVisible();
  });

  test('the kind filter offers Missing, Extra and Seen elsewhere', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/exceptions');
    await expect(screen.getByRole('heading', 'Exceptions')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('combobox').tap();
    for (const kind of ['Missing', 'Extra', 'Seen elsewhere']) await expect(screen.getByRole('option', kind)).toBeVisible();
  });

  test('a search that matches no case leaves the inbox empty', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/exceptions');
    await expect(screen.getByRole('heading', 'Exceptions')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('textbox').fill('zzzz-no-such-case');
    await expect(screen.getByText('0 cases')).toBeVisible({ timeout: 10_000 });
    await expect(screen.getByText('Nothing here').first()).toBeVisible();
  });

  test('a missing piece is resolved Found (back into stock) or confirmed Lost (written off)', { session: 'rina', tags: ['inventory'] }, async () => {
    test.skip(process.env.RIG_DC_HOSTING !== 'cloud', 'needs the cloud-hosted DC: the cloud\'s missing book only knows pieces its own ledger booked, and this rig\'s DC keeps its own');
  });

  test('a store\'s short receipt can be turned into a count of its stockroom with "Ask for a count"', { session: 'rina', tags: ['inventory'] }, async () => {
    test.skip(true, 'needs the store app to sign a surat jalan short (store domain); no gap exists on this rig');
  });
});
