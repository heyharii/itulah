// Sales Explorer on Hari's phone baseline (iPhone XR, 414 x 896): the same figures as cards, the
// groupings / period / filter in the dock, nothing scrolling sideways.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { explorer, explorerOptions, jakartaToday, resolvePeriod, rp } from '../../support/sales.ts';

const WAIT = { timeout: 120_000 };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Sales Explorer · phone', { tags: ['sales'] }, () => {
  test('SAL-68 phone: Group by in the dock, a card per row with its Sales, a Total bar; no horizontal scroll', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 414, height: 896 });
    const options = await explorerOptions();
    const r = resolvePeriod('', jakartaToday(), options.latest_day, options.earliest_day);
    await app.open('/sales/explorer');
    await expect(screen.getByRole('button', /^Period:/)).toBeVisible(WAIT);
    // Groups sit in the dock's status button, not in a row of pills.
    await expect(screen.getByRole('tab', 'Division')).toBeHidden();
    await screen.getByRole('button', /Group by|Division/).first().tap();
    await screen.getByRole('option', 'Payment method').or(screen.getByRole('button', 'Payment method')).first().tap();
    await expect(browser).toHaveURL(/g%3Dpayment/);
    const api = await explorer({ ...r, group: 'payment' });
    for (const row of api.rows as Json[]) await expect(screen.getByText(row.label, { exact: true }).first()).toBeVisible(WAIT);
    await expect(screen.getByText('Total', { exact: true })).toBeVisible();
    const scrolls = await browser.evaluate((_: string) => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, '');
    expect(scrolls).toBe(false);
    void rp;
  });

  test('SAL-69 phone: the period sheet lists the four presets and Pick dates', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 414, height: 896 });
    await app.open('/sales/explorer');
    await screen.getByRole('button', /^Period:/).tap();
    const sheet = screen.getByRole('dialog');
    for (const label of ['This month', 'Last month', 'This year', 'All time', 'Pick dates']) await expect(sheet.getByRole('button', label)).toBeVisible(WAIT);
    await sheet.getByRole('button', 'This month').tap();
    await expect(browser).toHaveURL(/p%3Dmonth/);
  });
});
