// The menus that lead to the article screens: Merchandise and Master list the same screens under two paths
// (the sidebar lights a department from the URL), with a few rows hidden on purpose (nav.ts files).
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, SLOW } from '../../support/merchandise.ts';

const TAGS = ['merchandise', 'menus'];
const link = (nav: any, label: string) => nav.getByRole('link', new RegExp(`^${label}( \\d+)?$`));

describe('Merchandise and Master menus', { tags: TAGS }, () => {
  test('MER-01 the Merchandise department lists the article screens in the owner\'s order and hides Units', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await app.open('/merchandise');
    const nav = screen.getByRole('navigation', 'Merchandise');
    for (const label of ['Articles', 'New Articles', 'Divisions', 'Tags', 'Sizes', 'Colors', 'Name Suggestions']) {
      await expect(link(nav, label)).toBeVisible(SLOW);
    }
    await expect(link(nav, 'Units & Conversions')).toHaveCount(0);
    await expect(link(nav, 'Suppliers')).toHaveCount(0);
  });

  test('MER-02 the Master department lists the same screens plus Suppliers, and hides Units, Destinations and Payment Templates', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await app.open('/master');
    const nav = screen.getByRole('navigation', 'Master');
    for (const label of ['Articles', 'New Articles', 'Divisions', 'Tags', 'Sizes', 'Colors', 'Name Suggestions', 'Suppliers']) {
      await expect(link(nav, label)).toBeVisible(SLOW);
    }
    for (const label of ['Units & Conversions', 'Destinations', 'Payment Templates', 'Units']) {
      await expect(link(nav, label)).toHaveCount(0);
    }
  });

  test('MER-03 New Articles carries the count of lines waiting to be named', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await app.open('/master');
    const nav = screen.getByRole('navigation', 'Master');
    await expect(nav.getByRole('link', /^New Articles/)).toBeVisible(SLOW);
    const waiting = await as('cloud', 'rina').get('/api/v1/article-setups/unidentified/count');
    const n = Number(waiting?.count ?? waiting?.total ?? waiting);
    if (n > 0) await expect(nav.getByRole('link', new RegExp(`^New Articles ${n}$`))).toBeVisible(SLOW);
  });

  test('MER-04 Suppliers is in the Procurement menu and the Master menu, and GA has its own Suppliers', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await app.open('/procurement/suppliers');
    await expect(link(screen.getByRole('navigation', 'Procurement'), 'Suppliers')).toBeVisible(SLOW);
    await expect(link(screen.getByRole('navigation', 'Procurement'), 'Sourcing')).toBeVisible();
    await app.open('/vendors');
    await expect(link(screen.getByRole('navigation', 'GA'), 'Suppliers')).toBeVisible(SLOW);
  });

  test('MER-05 nina (DC operations) can open Ops › Printing', { session: 'nina', tags: TAGS }, async ({ app, screen }) => {
    await app.open('/operations/tagging');
    await expect(screen.getByRole('heading', 'Printing')).toBeVisible(SLOW);
    // the row is in Ops' More fold, so the page itself is the proof that this role may open it
    await expect(screen.getByRole('tab', /^To print/)).toBeVisible();
  });
});
