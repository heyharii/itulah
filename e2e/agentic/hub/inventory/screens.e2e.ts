// The module as a whole: the sidebar, who may open it, and the screens that sit
// behind the fold or out of the sidebar (still routed, still linkable, still in ⌘K).
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, rows } from '../../support/rig.ts';
import { healInventoryModule } from '../../support/inventory.ts';

describe('Inventory: the module', { tags: ['inventory'] }, () => {
  test('the sidebar names Stock, Exceptions, Counts and Movements, and Inventory opens on Stock', { session: 'rina', tags: ['inventory', 'smoke'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/');
    await screen.getByRole('link', { name: /^Inventory/ }).tap();
    await expect(browser).toHaveURL(/\/inventory$/, { timeout: 20_000 });
    await expect(screen.getByRole('heading', 'Stock')).toBeVisible({ timeout: 30_000 });
    const nav = screen.getByRole('navigation', 'Inventory');
    for (const item of ['Stock', 'Counts', 'Movements']) await expect(nav.getByRole('link', { name: new RegExp(`^${item}`) })).toBeVisible();
    await expect(nav.getByRole('link', { name: /^Exceptions/ })).toBeVisible();
    // Pools, On Hand & Shortfall and the doubting surfaces are routed but not sub-items.
    for (const hidden of ['Pools', 'On Hand & Shortfall', 'Reconciliations', 'As of', 'Control', 'Time Machine', 'Flows']) {
      await expect(nav.getByRole('link', { name: new RegExp(`^${hidden}$`) })).toBeHidden();
    }
  });

  test('nina (DC operations) can open the Inventory module', { session: 'nina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory');
    await expect(screen.getByRole('heading', 'Stock')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText('Something went wrong!')).toBeHidden();
    await expect(screen.getByRole('link', { name: /^Inventory/ })).toBeVisible();
  });

  test('yusuf (head of the DC) can read the counts', { session: 'yusuf', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/counts');
    await expect(screen.getByRole('heading', 'Counts')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('row', { name: /Opname siklus gudang DC/ })).toBeVisible({ timeout: 20_000 });
  });
});

describe('Inventory: the screens behind the fold', { tags: ['inventory'] }, () => {
  test('Observations: what the readers saw, one row per tag, searchable by tag', { session: 'rina', tags: ['inventory', 'bug'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/observations');
    await expect(screen.getByRole('heading', 'Observations')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('tab', 'Observations')).toBeVisible();
    await expect(screen.getByRole('tab', /^Where they disagree/)).toBeVisible();
    for (const head of ['Tag', 'SKU', 'Seen in', 'Reader', 'Reads', 'Best RSSI', 'Last Seen']) {
      await expect(screen.getByRole('columnheader', head)).toBeVisible({ timeout: 20_000 });
    }
    const seen = rows(await as('cloud', 'rina').get('/api/v1/inventory/observations?limit=1'));
    expect(seen.length).toBeGreaterThan(0);
    const epc = seen[0].epc as string;
    await screen.getByRole('textbox', 'Search observations').fill(epc);
    await expect(screen.getByRole('row', { name: new RegExp(epc) }).first()).toBeVisible({ timeout: 20_000 });
    await expect(screen.getByRole('button', 'Submit a batch')).toBeVisible();
  });

  test('Observations: "Where they disagree" lists tags last seen away from where the ledger has them', { session: 'rina', tags: ['inventory', 'bug'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/observations');
    await screen.getByRole('tab', /^Where they disagree/).tap();
    // The tab asks GET /api/v1/inventory/observation-anomalies; the cloud has no such route any more,
    // so the tab shows a failure instead of its answer (or its empty sentence).
    await expect(screen.getByText('Every tag was last seen where the ledger says it is.')).toBeVisible({ timeout: 20_000 });
  });

  test('Claim Reconciliation: the DC\'s claims against the stores\', with its tallies', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/reconciliations');
    await expect(screen.getByRole('heading', 'Claim Reconciliation')).toBeVisible({ timeout: 30_000 });
    for (const label of ['Matched', 'In the air', 'Store only', 'Unresolved', 'Conflicts', 'Read at']) {
      await expect(screen.getByText(label).first()).toBeVisible({ timeout: 20_000 });
    }
  });

  test('Ledger Control: health, ledger facts and the projection difference counts', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/control');
    await expect(screen.getByRole('heading', 'Ledger Control')).toBeVisible({ timeout: 30_000 });
    const control = await as('cloud', 'rina').get('/api/v1/inventory/control');
    for (const label of ['Ledger health', 'Ledger facts', 'Row differences', 'Stage differences', 'Last replay', 'Last repost']) {
      await expect(screen.getByText(label).first()).toBeVisible({ timeout: 20_000 });
    }
    expect(control.ledger_health).toBe('HEALTHY');
    await expect(screen.getByText(/healthy/i).first()).toBeVisible();
  });

  test('As of: the ledger replayed to a moment, read only', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/as-of');
    await expect(screen.getByRole('heading', 'As of')).toBeVisible({ timeout: 30_000 });
    // It opens on a moment already (yesterday 23:00), replayed from the movements, and nothing on it can be posted.
    await expect(screen.getByText(/^Read only\. These are the balances as at /)).toBeVisible({ timeout: 20_000 });
    for (const label of ['Stock', 'On hand', 'Allotted']) await expect(screen.getByText(label).first()).toBeVisible();
    for (const head of ['Pool', 'Site', 'Group', 'Stock', 'On Hand', 'Allotted', 'Lost Rate']) await expect(screen.getByRole('columnheader', head)).toBeVisible();
  });

  test('Time Machine: fold the ledger to a fact', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/time-machine');
    await expect(screen.getByRole('heading', 'Time Machine')).toBeVisible({ timeout: 30_000 });
    for (const tab of ['State at a sequence', 'Ledger vs projection', 'Edge vs cloud', 'What if']) await expect(screen.getByRole('tab', tab)).toBeVisible();
    await expect(screen.getByText('Events applied')).toBeVisible({ timeout: 90_000 });
    await expect(screen.getByText('State hash')).toBeVisible();
    await expect(screen.getByText('The end of the ledger')).toBeVisible();
  });

  test('Goods Flows: the templates of the routes goods run', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await app.open('/inventory/flows');
    await expect(screen.getByRole('heading', 'Goods Flows')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('button', 'New flow')).toBeVisible();
    const flows = rows(await as('cloud', 'rina').get('/api/v1/flow-templates'));
    if (flows.length === 0) await expect(screen.getByText('No flows yet.')).toBeVisible({ timeout: 20_000 });
    else await expect(screen.getByRole('row').nth(1)).toBeVisible({ timeout: 20_000 });
  });
});

describe('Inventory: on a phone (414 x 896)', { tags: ['inventory'] }, () => {
  test('Counts are cards with the round New Count button, and the seeded count shows its figures', { session: 'rina', tags: ['inventory'] }, async ({ app, screen, browser }) => {
    await healInventoryModule(browser);
    await browser.setViewport({ width: 414, height: 896 });
    await app.open('/inventory/counts');
    await expect(screen.getByRole('button', 'Add New Count')).toBeVisible({ timeout: 60_000 });
    // Status, search and sort are the dock's, not a bar at the top.
    for (const name of ['Status: All counts', 'Search Counts', 'Filter and sort']) await expect(screen.getByRole('button', name)).toBeVisible();
    // Each count is a card: reason over pool, the difference it leads with, expected/found, kind · owner · day, status.
    const first = screen.getByRole('listitem').first();
    await expect(first).toContainText('difference', { timeout: 30_000 });
    await expect(first).toContainText(/Expected \d+ · Found \d+/);
    // The table's columns are cards here: no column headers.
    await expect(screen.getByRole('columnheader', 'Counted by')).toBeHidden();
  });
});

