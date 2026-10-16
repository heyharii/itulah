// Sales Explorer: the period over the top — the four presets, the date picker, and
// the empty sentence for a span with no sales.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { dayText, explorerMatches, explorerOptions, jakartaToday, periodLabel, resolvePeriod, shiftDay } from '../../support/sales.ts';

const WAIT = { timeout: 120_000 };
const PRESETS = [
  { label: 'This month', period: 'month' },
  { label: 'Last month', period: 'last' },
  { label: 'This year', period: '' },
  { label: 'All time', period: 'all' },
] as const;

describe('Sales Explorer · period', { tags: ['sales'] }, () => {
  for (const preset of PRESETS) {
    test(`SAL-02 preset "${preset.label}" re-asks the server for its days`, { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
      await app.open('/sales/explorer');
      await expect(screen.getByRole('textbox', 'Search divisions')).toBeVisible(WAIT);
      // Start from a different preset so the tap is a change.
      if (preset.label !== 'This year') await screen.getByRole('button', 'This year').tap();
      else await screen.getByRole('button', 'All time').tap();
      await screen.getByRole('button', preset.label).tap();
      await expect(screen.getByRole('button', preset.label)).toHaveAttribute('aria-pressed', 'true');
      for (const other of PRESETS.filter((p) => p.label !== preset.label)) await expect(screen.getByRole('button', other.label)).toHaveAttribute('aria-pressed', 'false');

      const options = await explorerOptions();
      const range = resolvePeriod(preset.period, jakartaToday(), options.latest_day, options.earliest_day);
      const outside = options.latest_day && (range.from > options.latest_day || (options.earliest_day && range.to < options.earliest_day));
      await explorerMatches(
        { screen, browser },
        { ...range, group: 'division' },
        outside ? { emptyText: `Nothing sold in this period. The latest sales day is ${dayText(options.latest_day)}.` } : {},
      );
    });
  }

  test('SAL-03 Pick dates: a shortcut + Apply sets the range, the button shows it, no preset stays lit', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales/explorer');
    await expect(screen.getByRole('textbox', 'Search divisions')).toBeVisible(WAIT);
    const options = await explorerOptions();
    const anchor = options.latest_day < jakartaToday() ? options.latest_day : jakartaToday();

    await screen.getByRole('button', 'Pick dates').tap();
    const calendar = screen.getByRole('dialog');
    await expect(calendar.getByText('Pick the first day')).toBeVisible();
    await expect(calendar.getByRole('button', 'Apply')).toBeDisabled();
    await calendar.getByRole('button', 'Last 7 days').tap();
    const from = shiftDay(anchor, -6);
    await expect(calendar.getByText(`${periodLabel(from, anchor)} · 7 days`)).toBeVisible();
    await calendar.getByRole('button', 'Apply').tap();
    await expect(screen.getByRole('dialog')).toBeHidden();
    await expect(screen.getByRole('button', periodLabel(from, anchor))).toBeVisible();
    for (const p of PRESETS) await expect(screen.getByRole('button', p.label)).toHaveAttribute('aria-pressed', 'false');
    await explorerMatches({ screen, browser }, { from, to: anchor, group: 'division' });
  });

  test('SAL-04 Pick dates: Today shows the trading day; Yesterday (no sales) says so; Cancel changes nothing', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales/explorer');
    await expect(screen.getByRole('textbox', 'Search divisions')).toBeVisible(WAIT);
    const options = await explorerOptions();
    const anchor = options.latest_day < jakartaToday() ? options.latest_day : jakartaToday();

    await screen.getByRole('button', 'Pick dates').tap();
    await screen.getByRole('dialog').getByRole('button', 'Cancel').tap();
    await expect(screen.getByRole('dialog')).toBeHidden();
    await expect(screen.getByRole('button', 'This year')).toHaveAttribute('aria-pressed', 'true');

    await screen.getByRole('button', 'Pick dates').tap();
    await screen.getByRole('dialog').getByRole('button', 'Today').tap();
    await screen.getByRole('dialog').getByRole('button', 'Apply').tap();
    await explorerMatches({ screen, browser }, { from: anchor, to: anchor, group: 'division' });

    const yesterday = shiftDay(anchor, -1);
    await screen.getByRole('button', periodLabel(anchor, anchor)).tap();
    await screen.getByRole('dialog').getByRole('button', 'Yesterday').tap();
    await screen.getByRole('dialog').getByRole('button', 'Apply').tap();
    if (options.earliest_day && yesterday < options.earliest_day) {
      await explorerMatches({ screen, browser }, { from: yesterday, to: yesterday, group: 'division' }, { emptyText: `Nothing sold in this period. The latest sales day is ${dayText(options.latest_day)}.` });
    }
  });

  test('SAL-05 the period survives a reload and the Back button walks back through it', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales/explorer');
    await expect(screen.getByRole('textbox', 'Search divisions')).toBeVisible(WAIT);
    await screen.getByRole('button', 'This month').tap();
    await expect(browser).toHaveURL(/p%3Dmonth/);
    await browser.reload();
    await expect(screen.getByRole('button', 'This month')).toHaveAttribute('aria-pressed', 'true', WAIT);
    await screen.getByRole('button', 'All time').tap();
    await expect(browser).toHaveURL(/p%3Dall/);
    await app.back();
    await expect(screen.getByRole('button', 'This month')).toHaveAttribute('aria-pressed', 'true');
  });
});
