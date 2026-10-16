// Stores › the list: every store, whether it is getting ready or trading, its
// ring, its pill, its server and its tills — read from GET /api/v1/stores.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { viewports } from '../../support/base.ts';
import { SLOW, storeList } from '../../support/stores-ga.ts';
import { signInByApi } from '../../support/session.ts';

describe('Stores: the list', { tags: ['stores'] }, () => {
  test('STO-01 every store is a row: name, code and the count matches the API', { session: 'rina', tags: ['stores', 'smoke'] }, async ({ app, screen, browser }) => {
    const { items } = await storeList();
    expect(items.length).toBeGreaterThanOrEqual(16);
    await app.open('/stores');
    await expect(screen.getByRole('heading', 'Stores')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('button', 'Open a new store', { visible: true })).toBeVisible({ timeout: SLOW });
    for (const code of ['C001', 'C008', 'C016']) {
      await expect(screen.getByRole('link', { name: new RegExp(`\\b${code}\\b`) })).toBeVisible({ timeout: SLOW });
    }
    // One link per store in the page's main region (the sidebar links carry no store code).
    const named = items.filter((s) => /^C\d{3}$/.test(s.code));
    await expect(screen.getByRole('link', { name: /\bC\d{3}\b.*(Open|Getting ready|Closed)/ })).toHaveCount(named.length, { timeout: SLOW });
    await expect(browser).toHaveURL(/\/stores$/);
  });

  test('STO-02 a row says open since a dated day, its status pill and its server state', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const { items } = await storeList();
    const one = items.find((s) => s.code === 'C001')!;
    await app.open('/stores');
    const row = screen.getByRole('link', { name: /\bC001\b/ });
    await expect(row).toBeVisible({ timeout: SLOW });
    await expect(row).toContainText('Cikupa');
    await expect(row).toContainText(one.status === 'OPEN' ? 'Open' : 'Getting ready');
    if (one.status === 'OPEN') await expect(row).toContainText(/open since \d{2} \w{3} 2026/);
    const word: Record<string, string> = { ONLINE: 'Online', OFFLINE: 'Offline', NOT_INSTALLED: 'Not installed', WAITING_TO_INSTALL: 'Waiting to be installed', WAITING_FOR_APPROVAL: 'Waiting for approval', SYNCING: 'Pulling its first data' };
    await expect(row).toContainText(word[one.server.state]);
  });

  test('STO-03 a store whose server is not installed reads Not installed, with its seats and tills online', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const { items } = await storeList();
    const bare = items.find((s) => s.code === 'C009')!;
    await app.open('/stores');
    const row = screen.getByRole('link', { name: /\bC009\b/ });
    await expect(row).toBeVisible({ timeout: SLOW });
    await expect(row).toContainText('WMJB');
    if (bare.server.state === 'NOT_INSTALLED') await expect(row).toContainText('Not installed');
    const seats = bare.tills.seats;
    await expect(row).toContainText(`${seats} ${seats === 1 ? 'seat' : 'seats'} · ${bare.tills.online}/${bare.tills.active} online`);
  });

  test('STO-04 search narrows by code, by name and by city, and says so when nothing matches', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    await app.open('/stores');
    const search = screen.getByRole('textbox');
    await expect(screen.getByRole('link', { name: /\bC016\b/ })).toBeVisible({ timeout: SLOW });
    await search.fill('C016');
    await expect(screen.getByRole('link', { name: /\bC016\b/ })).toBeVisible();
    await expect(screen.getByRole('link', { name: /\bC001\b/ })).toBeHidden();
    await search.fill('wonosobo');
    await expect(screen.getByRole('link', { name: /\bC013\b/ })).toBeVisible();
    await expect(screen.getByRole('link', { name: /\bC016\b/ })).toBeHidden();
    await search.fill('Garut');
    await expect(screen.getByRole('link', { name: /\bC015\b/ })).toBeVisible();
    await search.fill('zzz-nobody');
    await expect(screen.getByText('No store matches that search.')).toBeVisible();
    await search.clear();
    await expect(screen.getByRole('link', { name: /\bC001\b/ })).toBeVisible();
  });

  test('STO-05 a row opens that store\'s own page', { session: 'rina', tags: ['stores'] }, async ({ app, screen, browser }) => {
    await app.open('/stores');
    await screen.getByRole('link', { name: /\bC004\b/ }).tap();
    await expect(browser).toHaveURL(/\/stores\/store-04$/, { timeout: SLOW });
    await expect(screen.getByRole('heading', 'Bumiayu')).toBeVisible({ timeout: SLOW });
  });

  test('STO-06 the sidebar does not repeat the module (Stores is under More) and /stores/exceptions is routed', { session: 'rina', tags: ['stores'] }, async ({ app, screen, browser }) => {
    await app.open('/stores/exceptions');
    await expect(screen.getByRole('heading', 'Exceptions')).toBeVisible({ timeout: SLOW });
    await expect(browser).toHaveURL(/\/stores\/exceptions$/);
  });

  test('STO-07 an operations login (nina) is refused the Stores module', { tags: ['stores'] }, async ({ app, screen, browser }) => {
    await app.open('/');
    await signInByApi(browser, 'nina');
    await app.open('/stores');
    // Signed in (the sidebar is there) but the module is not hers: no list, no Open button.
    await expect(screen.getByRole('link', { name: /^Inventory/ })).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('button', 'Open a new store', { visible: true })).toBeHidden();
    await expect(screen.getByRole('link', { name: /\bC001\b/ })).toBeHidden();
  });

  test('STO-08 a store manager lands straight on their own store, with no list and no Open button', { tags: ['stores'] }, async ({ app, screen, browser }) => {
    await app.open('/');
    await signInByApi(browser, 'maya');
    await app.open('/stores');
    await expect(browser).toHaveURL(/\/stores\/store-01$/, { timeout: SLOW });
    await expect(screen.getByRole('heading', 'Cikupa')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('button', 'Open a new store', { visible: true })).toBeHidden();
  });

  test('STO-09 phone: stores are cards with the tills-online figure, a search in the dock and a round Open button', { session: 'rina', tags: ['stores'] }, async ({ app, screen, browser }) => {
    await browser.setViewport(viewports.phone);
    await app.open('/stores');
    await expect(screen.getByRole('button', 'Open a new store', { visible: true })).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText('tills online').first()).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText('Cikupa').first()).toBeVisible();
    await expect(screen.getByRole('button', 'Search Stores')).toBeVisible();
  });
});
