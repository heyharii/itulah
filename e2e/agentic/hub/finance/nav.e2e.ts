// The Finance menu (plain menu → sub-menu, ERPNext v15 Accounting groups) and every routed screen behind it.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as F from '../../support/finance.ts';
import * as R from '../../support/rig.ts';
import { ROUTES } from '../../support/finance-routes.ts';

const TAGS = ['finance', 'nav'];
const GROUPS = ['Overview', 'Stores', 'Inventory', 'Payables', 'Receivables', 'Payments', 'Banking', 'Financial Reports', 'Assets', 'Tax', 'Accounting Masters', 'Closing'];
const FOLDS = GROUPS.slice(1);

describe('the Finance menu', { tags: TAGS }, () => {
  test('the rail is a plain menu of ERPNext-style groups, in the owner\'s order, with Overview on top', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await app.open('/finance/dashboard');
    const rail = screen.getByRole('navigation', 'Finance');
    await expect(rail.getByRole('heading', 'Finance')).toBeVisible({ timeout: 60_000 });
    await expect(rail.getByRole('link', 'Overview').first()).toBeVisible();
    const buttons = (await rail.getByRole('button').allTextContents()).map((t) => t.replace(/\s*\d+$/, '').trim()).filter((t) => FOLDS.includes(t));
    expect(buttons).toEqual(FOLDS);
  });

  for (const group of FOLDS) {
    test(`${group}: opening the group lists exactly its rail rows (the "more" and hidden rows are not in the rail)`, { session: 'rina' }, async ({ app, screen }) => {
      await app.open('/finance/dashboard');
      const rail = screen.getByRole('navigation', 'Finance');
      await expect(rail.getByRole('button', { name: new RegExp('^' + group.replace(/[()&]/g, '\\$&') + '(\\s*\\d+)?$') })).toBeVisible({ timeout: 60_000 });
      const toggle = rail.getByRole('button', { name: new RegExp('^' + group.replace(/[()&]/g, '\\$&') + '(\\s*\\d+)?$') });
      if ((await toggle.getAttribute('aria-expanded').catch(() => null)) !== 'true') await toggle.tap();
      const rows = ROUTES.filter((r) => r[0] === group);
      for (const [, label, path, , hidden, more] of rows) {
        if (hidden || more) continue;
        await expect(rail.getByRole('link', { name: new RegExp('^' + label.replace(/[()&.]/g, '\\$&') + '(\\s*\\d+)?$') }).first(), `${group} › ${label} (${path})`).toBeVisible({ timeout: 15_000 });
      }
      for (const [, label, , , hidden, more] of rows) {
        if (!(hidden || more) || ['Petty Cash', 'Accruals', 'Overview'].includes(label)) continue;
        await expect(rail.getByRole('link', { name: label, exact: true }), `${group} › ${label} stays off the rail`).toHaveCount(0);
      }
    });
  }

  test('clicking a rail row goes to its page: BKM → /finance/cash-bank/bkm', { session: 'rina' }, async ({ app, screen, browser }) => {
    await app.open('/finance/dashboard');
    const rail = screen.getByRole('navigation', 'Finance');
    await rail.getByRole('button', { name: /^Payments/ }).tap();
    await rail.getByRole('link', 'BKM').tap();
    await expect(browser).toHaveURL(/\/finance\/cash-bank\/bkm$/);
    await F.onScreen(screen, 'BKM');
  });
});

describe('the Finance menu on a phone', { tags: [...TAGS, 'phone'] }, () => {
  test('a phone has the "Main" bottom bar (Home, the first rows, More) and no rail; every row of the department is reachable from More', { session: 'rina' }, async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 414, height: 896 });
    await app.open('/finance/dashboard');
    const bar = screen.getByRole('navigation', 'Main');
    await expect(bar).toBeVisible({ timeout: 60_000 });
    await expect(bar.getByRole('button', 'Home')).toBeVisible();
    await expect(bar.getByRole('link', 'Sales by Day')).toBeVisible();
    await expect(screen.getByRole('navigation', 'Finance')).toHaveCount(0);
    await bar.getByRole('button', 'More').tap();
    const sheet = screen.getByRole('dialog', 'Finance'); // More opens the same groups as a sheet
    for (const group of FOLDS) await expect(sheet.getByRole('button', { name: new RegExp('^' + group + '(\\s*\\d+)?$') })).toBeVisible({ timeout: 15_000 });
    await sheet.getByRole('button', { name: /^Payments/ }).tap();
    await expect(sheet.getByRole('link', 'BKM')).toBeVisible({ timeout: 15_000 });
  });
});

describe('who may see Finance', { tags: TAGS }, () => {
  test('warehouse staff (nina, OPERATIONS) are refused by the API and have no Finance in the menu', { session: 'nina' }, async ({ app, screen }) => {
    for (const path of ['/api/v1/finance/bills', '/api/v1/finance/cash-documents', '/api/v1/finance/journal', '/api/v1/finance/periods']) {
      const r = await R.as('cloud', 'nina').call('GET', path, undefined, { ok: false });
      expect(JSON.stringify(r)).toMatch(/forbidden|permission|not allowed|access/i);
    }
    const write = await R.as('cloud', 'nina').call('POST', '/api/v1/finance/journal', { posting_date: F.today(), memo: 'x', lines: [] }, { ok: false });
    expect(JSON.stringify(write)).toMatch(/forbidden|permission|not allowed|access/i);
    await app.open('/operations/workload');
    await expect(screen.getByRole('navigation', 'Navigation').getByRole('link', 'Ops')).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByRole('navigation', 'Navigation').getByRole('link', 'Finance')).toHaveCount(0);
  });

  test('typing a Finance address as warehouse staff shows no Finance data', { session: 'nina' }, async ({ app, screen }) => {
    await app.open('/finance/payables/bills');
    await expect(screen.getByText('You do not have access to what the company owes its suppliers.', { exact: false })).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText('INV-', { exact: false })).toHaveCount(0);
  });
});

describe('moved modules redirect', { tags: TAGS }, () => {
  for (const [from, to] of [
    ['/finance-final', /\/finance/],
    ['/finance-lab', /\/finance/],
    ['/finance-lab-2', /\/finance/],
    ['/finance/bills', /\/finance\/payables\/bills/],
    ['/finance/journal', /\/finance\/accounting\/journal-entries/],
    ['/finance/accounts', /\/finance\/accounting\/chart-of-accounts/],
    ['/finance/periods', /\/finance\/setup\/periods/],
    ['/finance/reports', /\/finance\/reports\/profit-and-loss/],
    ['/finance/payroll/runs', /\/finance/],
  ] as const) {
    test(`${from} lands on a live screen`, { session: 'rina' }, async ({ app, screen, browser }) => {
      await app.open(from);
      await expect(browser).toHaveURL(to, { timeout: 60_000 });
      await expect(screen.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
      await expect(screen.getByText('This screen is routed but not written yet')).toBeHidden();
    });
  }
});

describe('every routed Finance screen opens on its own page', { tags: TAGS }, () => {
  for (const group of GROUPS) {
    test(`${group}: each path draws its heading, never the Placeholder`, { session: 'rina', timeout: 900_000 }, async ({ app, screen }) => {
      for (const [, label, path, h1] of ROUTES.filter((r) => r[0] === group)) {
        await app.open(path);
        if (h1) await expect(screen.getByRole('heading', { name: h1, level: 1 }), `${label} (${path})`).toBeVisible({ timeout: 90_000 });
        else await expect(screen.getByRole('heading', { level: 1 }), `${label} (${path})`).toBeVisible({ timeout: 90_000 });
        await expect(screen.getByText('This screen is routed but not written yet'), `${path} is the Placeholder`).toBeHidden();
      }
    });
  }

  test('the document pages of BKK / BKM answer by id: an unknown id is said, not a blank page', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/cash-bank/bkk/00000000-0000-0000-0000-000000000000');
    await expect(screen.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText(/Reading the document…|not found|could not|no document|unknown/i).first()).toBeVisible({ timeout: 30_000 });
  });
});
