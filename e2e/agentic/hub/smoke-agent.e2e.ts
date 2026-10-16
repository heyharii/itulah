// The model is reachable: one judgement and one small goal on the PO list.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('the agent reads the PO list and opens the New PO form', { session: 'rina', tags: ['smoke', 'agent'] }, async ({ app, agent, browser, screen }) => {
  await app.open('/procurement/orders');
  await expect(screen.getByRole('button', 'New order')).toBeVisible({ timeout: 60_000 });
  await agent.assert('the screen shows the Purchase Orders list');
  await agent.act('open the form for a new purchase order');
  await expect(browser).toHaveURL(/new-order=true/);
});
