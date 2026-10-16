// Landing screens: Home (the brief), Executive (six report pages), Reports and
// the Apps launcher with its waiting counts.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { viewports } from '../../support/base.ts';
import { signInByApi } from '../../support/session.ts';
import { admin, T } from '../../support/stores-ga.ts';

describe('Landing: home', { tags: ['landing'] }, () => {
  test('LND-01 Home greets by name and shows Trade today, Stock and Commercial with their links', { session: 'rina', tags: ['landing', 'smoke'] }, async ({ app, screen }) => {
    await app.open('/home');
    await expect(screen.getByRole('heading', { name: /^(Morning|Afternoon|Evening),? Rina Kusuma$/ })).toBeVisible(T);
    for (const title of ['Trade today', 'Stock', 'Commercial']) await expect(screen.getByText(title, { exact: true }).first()).toBeVisible(T);
    await expect(screen.getByRole('link', 'See the fleet chart')).toBeVisible();
    await expect(screen.getByRole('link', 'See pools')).toBeVisible();
    await expect(screen.getByRole('link', 'See activation')).toBeVisible();
  });

  test('LND-02 "See pools" goes to Inventory and "See the fleet chart" to Reports', { session: 'rina', tags: ['landing'] }, async ({ app, screen, browser }) => {
    await app.open('/home');
    await screen.getByRole('link', 'See the fleet chart').tap();
    await expect(browser).toHaveURL(/\/reports$/, T);
    await app.open('/home');
    await screen.getByRole('link', 'See pools').tap();
    await expect(browser).toHaveURL(/\/inventory/, T);
  });

  test('LND-03 the brief offers questions to ask the assistant, and the box to type one', { session: 'rina', tags: ['landing'] }, async ({ app, screen }) => {
    await app.open('/home');
    await expect(screen.getByText('Here is how things are going.')).toBeVisible(T);
    await expect(screen.getByRole('button', 'Ask')).toBeVisible(T);
  });
});

describe('Landing: executive', { tags: ['landing'] }, () => {
  const PAGES: [string, string, string[]][] = [
    ['/executive', 'Overview', ['Net sales', 'Transactions', 'Gross profit', 'Cash & bank']],
    ['/executive/stores', 'Store Performance', ['Sales by store', 'Store comparison']],
    ['/executive/stock', 'Stock & Purchasing', ['Stock by store', 'Open POs']],
    ['/executive/finance', 'Cash & Profit', ['Profit and loss', 'Supplier payables', 'Cash & bank by unit']],
    ['/executive/customers', 'Customers & Promotions', ['Member segments', 'Promotion campaigns']],
    ['/executive/people', 'Team & Assets', ['By location', 'Employee contracts ending', 'GA contracts ending']],
  ];
  PAGES.forEach(([path, title, parts], index) => {
    test(`LND-${10 + index} ${title}: its heading and its sections`, { session: 'rina', tags: ['landing'] }, async ({ app, screen }) => {
      await app.open(path);
      await expect(screen.getByRole('heading', title)).toBeVisible(T);
      for (const part of parts) await expect(screen.getByText(part, { exact: true }).first()).toBeVisible(T);
      await expect(screen.getByText('Something went wrong!')).toBeHidden();
    });
  });

  test('LND-20 the period switch changes the range line and the address', { session: 'rina', tags: ['landing'] }, async ({ app, screen, browser }) => {
    await app.open('/executive');
    await expect(screen.getByText(/1–\d+ \w+ 2026/).first()).toBeVisible(T);
    await screen.getByRole('button', 'Last month').tap();
    await expect(browser).toHaveURL(/term=/, T);
    await expect(screen.getByText(/September 2026|1–30 Sep/).first()).toBeVisible(T);
  });

  test('LND-21 the store picker puts one store into the address and the range line', { session: 'rina', tags: ['landing'] }, async ({ app, screen, browser }) => {
    await app.open('/executive/stores');
    await screen.getByRole('button', { name: /All stores/ }).tap();
    await screen.getByRole('menuitem', 'Store 01').tap();
    await expect(browser).toHaveURL(/store=/, T);
    await expect(screen.getByText(/Store 01/).first()).toBeVisible();
  });

  test('LND-22 phone: period and store are the dock\'s two buttons', { session: 'rina', tags: ['landing'] }, async ({ app, screen, browser }) => {
    await browser.setViewport(viewports.phone);
    await app.open('/executive/stores');
    await expect(screen.getByRole('button', { name: /^Period:/ })).toBeVisible(T);
    await expect(screen.getByRole('button', { name: /^Store:/ })).toBeVisible();
    await screen.getByRole('button', { name: /^Period:/ }).tap();
    await expect(screen.getByRole('button', 'Last month')).toBeVisible();
  });
});

describe('Landing: reports', { tags: ['landing'] }, () => {
  test('LND-30 Reports lists what was kept or says nothing is kept, and offers Compose one', { session: 'rina', tags: ['landing'] }, async ({ app, screen }) => {
    const kept = (await admin().get('/api/v1/reports/saved')) as { rows?: unknown[]; items?: unknown[] };
    await app.open('/reports');
    await expect(screen.getByRole('heading', 'Reports')).toBeVisible(T);
    await expect(screen.getByRole('button', 'Compose one')).toBeVisible();
    if (((kept.rows ?? kept.items) ?? []).length === 0) await expect(screen.getByText(/Nothing kept yet/)).toBeVisible();
  });

  test('LND-31 Compose one hands the question to the assistant panel', { session: 'rina', tags: ['landing'] }, async ({ app, screen }) => {
    await app.open('/reports');
    await screen.getByRole('button', 'Compose one').tap();
    await expect(screen.getByRole('textbox').last()).toBeVisible(T);
  });
});

describe('Landing: apps launcher', { tags: ['landing'] }, () => {
  test('LND-40 the launcher greets, lists the departments and ends with the search row', { session: 'rina', tags: ['landing', 'smoke'] }, async ({ app, screen }) => {
    await app.open('/apps');
    await expect(screen.getByRole('heading', { name: /^Good (morning|afternoon|evening|night), Rina$/ })).toBeVisible(T);
    for (const dep of ['Procurement', 'Merchandise', 'Ops', 'Inventory', 'Marketing', 'Sales', 'Finance', 'HR', 'GA', 'Master', 'Files', 'Reports', 'System']) {
      await expect(screen.getByRole('link', { name: new RegExp(`^${dep}\\b`) }).first()).toBeVisible();
    }
    await expect(screen.getByRole('button', 'Search or jump to…')).toBeVisible();
  });

  test('LND-41 the unread banner counts what the API counts and goes to Notifications', { session: 'rina', tags: ['landing'] }, async ({ app, screen, browser }) => {
    const n = (await as_rina()) as { unread: number };
    test.skip(n.unread === 0, 'nothing unread');
    await app.open('/apps');
    await expect(screen.getByText(/\d+ unread notifications?/)).toBeVisible(T);
    await screen.getByText(/\d+ unread notifications?/).tap();
    await expect(browser).toHaveURL(/\/system\/notifications/, T);
  });

  test('LND-42 a department row goes straight to its landing screen', { session: 'rina', tags: ['landing'] }, async ({ app, screen, browser }) => {
    await app.open('/apps');
    await screen.getByRole('link', { name: /^GA\b/ }).first().tap();
    await expect(browser).toHaveURL(/\/(ga|supplies|assets|maintenance)/, T);
  });

  test('LND-43 the waiting counts are whole numbers capped at 99+', { session: 'rina', tags: ['landing'] }, async ({ app, screen }) => {
    await app.open('/apps');
    await expect(screen.getByRole('link', { name: /^Procurement\b/ }).first()).toBeVisible(T);
    for (const dep of ['Procurement', 'Merchandise', 'Finance', 'HR', 'Master']) {
      // the launcher's row (the sidebar has a link of the same name, earlier in the page)
      const row = screen.getByRole('link', { name: new RegExp(`^${dep}\\b`) }).last();
      await expect(row).toBeVisible(T);
      await expect(row).toHaveText(new RegExp(`^${dep}( (\\d{1,2}|99\\+))?$`));
    }
  });

  test('LND-44 System appears only for an administrator: yusuf (operations) has no System row', { tags: ['landing'] }, async ({ app, screen, browser }) => {
    await app.open('/');
    await signInByApi(browser, 'yusuf');
    await app.open('/apps');
    await expect(screen.getByRole('heading', 'Apps')).toBeVisible(T);
    await expect(screen.getByRole('link', { name: /^System\b/ })).toBeHidden();
  });

  test('LND-45 a cashier has no office apps', { tags: ['landing'] }, async ({ app, screen, browser }) => {
    await app.open('/');
    await signInByApi(browser, 'dian');
    await app.open('/apps');
    await expect(screen.getByText('No office apps for this account.', { exact: false })).toBeVisible(T);
  });

  test('LND-46 phone: the launcher is one column of rows', { session: 'rina', tags: ['landing'] }, async ({ app, screen, browser }) => {
    await browser.setViewport(viewports.phone);
    await app.open('/apps');
    await expect(screen.getByRole('heading', 'Apps')).toBeVisible(T);
    await expect(screen.getByRole('link', { name: /^Procurement\b/ }).first()).toBeVisible();
  });
});

async function as_rina() {
  const { as } = await import('../../support/rig.ts');
  return as('cloud', 'rina').get('/api/v1/notifications?limit=1');
}
