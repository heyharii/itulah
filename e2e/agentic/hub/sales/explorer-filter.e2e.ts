// Sales Explorer: the Filter sheet (Stores · Division · Tag · Supplier · Colour · Size ·
// Saved views) and the line that says what is narrowing the rows.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { explorer, explorerMatches, explorerOptions, jakartaToday, resolvePeriod } from '../../support/sales.ts';
import { tag } from '../../support/rig.ts';

const WAIT = { timeout: 120_000 };

async function range() {
  const options = await explorerOptions();
  return { range: resolvePeriod('', jakartaToday(), options.latest_day, options.earliest_day), options };
}

describe('Sales Explorer · filters', { tags: ['sales'] }, () => {
  test('SAL-11 store filter across every store (16 or more): the store with sales shows its rows, the others show the empty sentence and zero totals', { session: 'rina', timeout: 1_800_000 }, async ({ app, screen, browser }) => {
    const { range: r, options } = await range();
    expect(options.stores.length).toBeGreaterThanOrEqual(16);
    for (const store of options.stores as { code: string; label: string }[]) {
      await app.open(`/sales/explorer?f=${encodeURIComponent(`st=${store.code}`)}`);
      await expect(screen.getByRole('textbox', 'Search divisions')).toBeVisible(WAIT);
      await expect(screen.getByText(`Stores: ${store.label}`)).toBeVisible(WAIT);
      const api = await explorer({ ...r, group: 'division', stores: [store.code] });
      await explorerMatches({ screen, browser }, { ...r, group: 'division', stores: [store.code] }, api.rows_total === 0 ? { emptyText: 'Nothing sold in this period.' } : {});
    }
  });

  test('SAL-12 Filter sheet › Stores: search, tick, the badge, the applied line, Clear', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    const { range: r } = await range();
    await app.open('/sales/explorer');
    await expect(screen.getByRole('textbox', 'Search divisions')).toBeVisible(WAIT);
    await screen.getByRole('button', /^Filter/).tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('button', /^Stores/)).toBeVisible();
    await expect(sheet.getByRole('checkbox')).toHaveCount((await explorerOptions()).stores.length);
    await sheet.getByRole('textbox', 'Search stores').fill('Tasik');
    await expect(sheet.getByRole('checkbox')).toHaveCount(1);
    await sheet.getByRole('textbox', 'Search stores').fill('zzz');
    await expect(sheet.getByText('Nothing matches.')).toBeVisible();
    await sheet.getByRole('textbox', 'Search stores').fill('');
    await sheet.getByRole('checkbox', 'Store 01').check();
    await expect(sheet.getByRole('button', /^Show \d+ divisions?$/)).toBeVisible();
    await sheet.getByRole('checkbox', 'Store 02').check();
    await sheet.getByRole('button', /^Show /).tap();
    await expect(screen.getByRole('dialog')).toBeHidden();
    await expect(screen.getByText('Stores: Store 01, Store 02')).toBeVisible();
    await expect(screen.getByRole('button', /^Filter/)).toContainText('1');
    await explorerMatches({ screen, browser }, { ...r, group: 'division', stores: ['store-01', 'store-02'] });
    await screen.getByRole('button', 'Clear').tap();
    await expect(screen.getByText('Stores: Store 01, Store 02')).toBeHidden();
    await explorerMatches({ screen, browser }, { ...r, group: 'division' });
  });

  for (const pane of [
    { key: 'divisions', label: 'Division', param: 'divisions', applied: 'Division' },
    { key: 'tags', label: 'Tag', param: 'tags', applied: 'Tag' },
    { key: 'suppliers', label: 'Supplier', param: 'suppliers', applied: 'Supplier' },
    { key: 'colours', label: 'Colour', param: 'colours', applied: 'Colour' },
    { key: 'sizes', label: 'Size', param: 'sizes', applied: 'Size' },
  ] as const) {
    test(`SAL-13 Filter sheet › ${pane.label}: one choice narrows the rows and the Total to it`, { session: 'rina', timeout: 600_000 }, async ({ app, screen, browser }) => {
      const { range: r, options } = await range();
      // The first choice in this pane that has sales behind it.
      let pick: { code: string; label: string } | undefined;
      for (const one of options[pane.key] as { code: string; label: string }[]) {
        const probe = await explorer({ ...r, group: 'division', [pane.param]: [one.code] } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (probe.rows_total > 0) { pick = one; break; }
      }
      test.skip(!pick, `no ${pane.label} with sales in the rig`);
      await app.open('/sales/explorer');
      await expect(screen.getByRole('textbox', 'Search divisions')).toBeVisible(WAIT);
      await screen.getByRole('button', /^Filter/).tap();
      const sheet = screen.getByRole('dialog');
      await sheet.getByRole('button', new RegExp(`^${pane.label}`)).tap();
      await sheet.getByRole('checkbox', pick!.label).check();
      await sheet.getByRole('button', /^Show /).tap();
      await expect(screen.getByRole('dialog')).toBeHidden();
      await expect(screen.getByText(`${pane.applied}: ${pick!.label}`)).toBeVisible();
      await explorerMatches({ screen, browser }, { ...r, group: 'division', [pane.param]: [pick!.code] } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    });
  }

  test('SAL-14 Reset in the sheet empties every pane; the summary beside a pane says All or how many', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    const { range: r } = await range();
    await app.open(`/sales/explorer?f=${encodeURIComponent('st=store-01&dv=PRIA')}`);
    await expect(screen.getByText('Stores: Store 01 · Division: Pria')).toBeVisible(WAIT);
    await screen.getByRole('button', /^Filter/).tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('button', /^Stores\s*1$/)).toBeVisible();
    await expect(sheet.getByRole('button', /^Tag\s*All$/)).toBeVisible();
    await sheet.getByRole('button', 'Reset').tap();
    await expect(sheet.getByRole('button', /^Stores\s*All$/)).toBeVisible();
    await sheet.getByRole('button', /^Show /).tap();
    await expect(screen.getByText('Stores: Store 01 · Division: Pria')).toBeHidden();
    await explorerMatches({ screen, browser }, { ...r, group: 'division' });
  });

  test('SAL-15 Saved views: save the combination, apply it from a clean screen, delete it', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    const { range: r } = await range();
    const name = `Uji ${tag('V')}`;
    await app.open(`/sales/explorer?f=${encodeURIComponent('g=tag&st=store-01&p=month')}`);
    await expect(screen.getByRole('tab', 'Tag')).toHaveAttribute('aria-selected', 'true', WAIT);
    await screen.getByRole('button', /^Filter/).tap();
    let sheet = screen.getByRole('dialog');
    await sheet.getByRole('button', /^Saved views/).tap();
    await expect(sheet.getByRole('button', 'Save view')).toBeDisabled();
    await sheet.getByRole('textbox', 'Name this view').fill(name);
    await sheet.getByRole('button', 'Save view').tap();
    await expect(sheet.getByRole('button', name)).toBeVisible();
    await sheet.getByRole('button', /^Show /).tap();

    // A clean screen, same browser: the view is there and takes the screen back.
    await app.open('/sales/explorer');
    await expect(screen.getByRole('tab', 'Division')).toHaveAttribute('aria-selected', 'true', WAIT);
    await screen.getByRole('button', /^Filter/).tap();
    sheet = screen.getByRole('dialog');
    await sheet.getByRole('button', /^Saved views/).tap();
    await sheet.getByRole('button', name).tap();
    await expect(screen.getByRole('dialog')).toBeHidden();
    await expect(screen.getByRole('tab', 'Tag')).toHaveAttribute('aria-selected', 'true');
    await expect(screen.getByRole('button', 'This month')).toHaveAttribute('aria-pressed', 'true');
    await expect(screen.getByText('Stores: Store 01')).toBeVisible();
    const options = await explorerOptions();
    const month = resolvePeriod('month', jakartaToday(), options.latest_day, options.earliest_day);
    await explorerMatches({ screen, browser }, { ...month, group: 'tag', stores: ['store-01'] });

    await screen.getByRole('button', /^Filter/).tap();
    sheet = screen.getByRole('dialog');
    await sheet.getByRole('button', /^Saved views/).tap();
    await sheet.getByRole('button', `Delete ${name}`).tap();
    await expect(sheet.getByRole('button', name)).toBeHidden();
    void r;
  });
});
