// The one agent-driven Inventory flow: a person asks for a count in plain words.
// (Haiku drives it; reword the goal with on-screen labels before reaching for a bigger model.)
import { test } from '@e2e-dev/web';
import { expect, unique } from 'e2e';
import { cloudCounts, closeOpenCounts, healInventoryModule, reason } from '../../support/inventory.ts';
import { tag, waitFor } from '../../support/rig.ts';

test('an agent asks for a count of the Garut stockroom through New count', { session: 'rina', tags: ['inventory', 'agent'], timeout: 300_000 }, async ({ app, agent, screen, browser }) => {
  const t = tag('IV');
  const why = reason(t, 'agent Garut');
  await closeOpenCounts('store-c015');
  await healInventoryModule(browser);
  await app.open('/inventory/counts');
  await expect(screen.getByRole('heading', 'Counts')).toBeVisible({ timeout: 30_000 });
  await agent.act(
    'Press New count. In the form choose the Pool "store-c015 · Warehouse", leave the Kind as Full, type {why} into Reason, then press Submit.',
    { params: { why: unique(why) } },
  );
  // On success the form clears its reason.
  await expect(screen.getByRole('textbox', 'Reason (required)')).toHaveValue('', { timeout: 20_000 });
  const made = await waitFor(`count ${why}`, async () => (await cloudCounts(t))[0], 30_000, 1_000);
  expect(made).toMatchObject({ site_id: 'store-c015', pool_id: 'store-c015.warehouse', kind: 'FULL', status: 'DRAFT', created_by: 'rina' });
});
