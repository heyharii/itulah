// Marketing Overview: the money the offers moved, what is still owed, and the way into each list.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { has, ledger, see } from '../../support/marketing.ts';

const TAGS = ['marketing', 'overview'];

describe('marketing overview', { tags: TAGS }, () => {
  test('it opens on the figures and the three campaign/promotion/voucher blocks', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await app.open('/commercial');
    await expect(screen.getByRole('heading', 'Overview')).toBeVisible({ timeout: 60_000 });
    await see(screen, 'Given away', 'Baskets touched', 'Campaigns running', 'Vouchers outstanding', 'What the offers gave away', 'Promotions doing the work', 'What the business still owes');
  });

  test('"Vouchers outstanding" is the voucher ledger liability', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial');
    await expect(screen.getByText('Vouchers outstanding')).toBeVisible({ timeout: 60_000 });
    const l = await ledger();
    await see(screen, 'Rp ' + l.outstanding_minor.toLocaleString('id-ID'));
  });

  test('the running campaigns are listed with their headline', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial');
    await expect(screen.getByText('Pekan Sepatu').first()).toBeVisible({ timeout: 60_000 });
    await see(screen, 'Gajian Hemat', 'Running');
  });

  test('each block opens its list', { session: 'rina' }, async ({ app, screen, browser }) => {
    for (const [link, path] of [['Open Campaigns', /\/commercial\/campaigns/], ['Open Promotions', /\/commercial\/promotions/], ['Open Vouchers', /\/commercial\/vouchers/], ['Open Prices', /\/commercial\/prices/], ['Open Changes', /\/commercial\/changes/]] as const) {
      await app.open('/commercial');
      await screen.getByRole('link', link).tap();
      await expect(browser).toHaveURL(path);
    }
  });

  test('the rail lists the Marketing screens', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial');
    const rail = screen.getByRole('navigation', 'Marketing');
    for (const name of ['Pricelist', 'Promotions', 'Campaigns', 'Vouchers']) await expect(rail.getByRole('link', name)).toBeVisible({ timeout: 60_000 });
  });

});
