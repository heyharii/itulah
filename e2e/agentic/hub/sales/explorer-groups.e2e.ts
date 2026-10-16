// Sales Explorer (/sales/explorer): every grouping, read the way a person reads it —
// the tab, the KPI strip, the table with its Total foot, the row count under it —
// each figure held against GET /api/v1/reports/sales/explorer.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { explorerMatches, explorerOptions, GROUPS, jakartaToday, resolvePeriod } from '../../support/sales.ts';

const WAIT = { timeout: 120_000 };

describe('Sales Explorer · groupings', { tags: ['sales'] }, () => {
  for (const g of GROUPS) {
    test(`SAL-01 ${g.label} tab: KPI strip, rows and Total equal the API`, { session: 'rina', tags: ['sales', ...(g.value === 'division' ? ['smoke'] : [])], timeout: 400_000 }, async ({ app, screen, browser }) => {
      await app.open('/sales/explorer');
      await expect(screen.getByRole('tab', 'Division')).toHaveAttribute('aria-selected', 'true', WAIT);
      if (g.value !== 'division') {
        await screen.getByRole('tab', g.label).tap();
        await expect(screen.getByRole('tab', g.label)).toHaveAttribute('aria-selected', 'true');
        await expect(browser).toHaveURL(new RegExp(`g%3D${g.value}`));
      }
      await expect(screen.getByRole('textbox', `Search ${g.many}`)).toBeVisible(WAIT);
      const options = await explorerOptions();
      const range = resolvePeriod('', jakartaToday(), options.latest_day, options.earliest_day);
      await explorerMatches({ screen, browser }, { ...range, group: g.value });
    });
  }
});
