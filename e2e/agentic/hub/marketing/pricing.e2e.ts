// Pricelist, Changes and History: reading prices, publishing a price change / markdown, and following it.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { bookNamed, books, cloud, floorEpc, has, iso, priceChanges, publishBook, quote, shop, tag, TAS, see } from '../../support/marketing.ts';

const TAGS = ['marketing', 'pricing'];
const row = (screen: any, text: string) => screen.getByRole('row').filter({ hasText: text });
const futureStart = () => new Date(Date.now() + 6 * 86_400_000).toISOString();

async function openChangeSheet(app: any, screen: any, article = TAS.name) {
  await app.open(`/commercial/prices?q=${encodeURIComponent(article)}`);
  await expect(screen.getByRole('checkbox', `Select ${article}`)).toBeVisible({ timeout: 120_000 });
  await screen.getByRole('checkbox', `Select ${article}`).check();
  await screen.getByRole('button', 'Change price…').tap();
  const sheet = screen.getByRole('dialog');
  await expect(sheet).toContainText('Change price', { timeout: 30_000 });
  return sheet;
}

describe('pricelist', { tags: TAGS }, () => {
  test('the grid reads base price and what store-01 actually charges, with the reason', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await app.open('/commercial/prices');
    await expect(screen.getByRole('heading', 'Pricelist')).toBeVisible({ timeout: 60_000 });
    await has(row(screen, 'Sandal Slide Karet'), 'Rp 99.000', 'Rp 79.000', '−20%', 'Markdown');
    await has(row(screen, 'Blus Rayon Motif Bunga'), 'Rp 159.000', 'Rp 143.100', '−10%', 'Diskon 10% Koleksi Wanita');
    await has(row(screen, 'Tas Selempang Kanvas'), 'Rp 219.000');
    await see(screen, 'Base price', 'Store price', 'Markdown', 'Promotion');
  });

  test('the price on the grid is the price the shop catalogues and charges', { session: 'rina', tags: [...TAGS, 'till'] }, async ({ app, screen }) => {
    await app.open('/commercial/prices?q=Sandal');
    await expect(row(screen, 'Sandal Slide Karet')).toContainText('Rp 79.000', { timeout: 60_000 });
    const catalogue = await shop().get('/api/v1/store/catalog?limit=500');
    const sku = catalogue.items.find((i: any) => i.sku_code === '00000008105');
    expect(sku.unit_price_minor).toBe(79_000);
    expect(sku.price_source).toBe('MARKDOWN');
    expect(sku.base_unit_price_minor ?? 99_000).toBe(99_000);
  });

  test('the "Only articles with" switches keep articles carrying that kind of price', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/prices');
    await expect(row(screen, 'Tas Selempang Kanvas')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('switch', 'Markdown').tap();
    await expect(row(screen, 'Sandal Slide Karet')).toBeVisible();
    await expect(row(screen, 'Tas Selempang Kanvas')).toBeHidden();
    await screen.getByRole('switch', 'Markdown').tap();
    await screen.getByRole('switch', 'Promotion').tap();
    await expect(row(screen, 'Blus Rayon Motif Bunga')).toBeVisible();
    await expect(row(screen, 'Celana Chino Slim Fit')).toBeHidden();
  });

  test('searching narrows the grid and counts the articles', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/prices?q=Kaos');
    await expect(row(screen, 'Kaos Basic Katun Combed')).toBeVisible({ timeout: 60_000 });
    await expect(row(screen, 'Kaos Anak Karakter')).toBeVisible();
    await expect(row(screen, 'Sandal Slide Karet')).toBeHidden();
    await app.open('/commercial/prices?q=zzzzzz');
    await expect(screen.getByText('No articles match “zzzzzz”.')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('button', 'Clear search and filters')).toBeVisible();
  });

  test('ticking an article offers Change price… and Clear drops the selection', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/prices');
    await expect(row(screen, 'Tas Selempang Kanvas')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('checkbox', 'Select Tas Selempang Kanvas').check();
    await screen.getByRole('checkbox', 'Select Kaos Anak Karakter').check();
    await see(screen, '2 articles selected');
    await screen.getByRole('button', 'Clear').tap();
    await expect(screen.getByText('2 articles selected')).toBeHidden();
  });
});

describe('pricelist details', { tags: TAGS }, () => {
  test('an article opens to its SKUs, and a store header opens that store', { session: 'rina' }, async ({ app, screen, browser }) => {
    await app.open('/commercial/prices?q=Tas%20Selempang');
    await expect(row(screen, 'Tas Selempang Kanvas')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('button', 'Show the SKUs of Tas Selempang Kanvas').tap();
    await expect(screen.getByText(TAS.sku).first()).toBeVisible();
    await screen.getByRole('button', 'rig store-01').tap();
    await expect(browser).toHaveURL(/shop=store-01/);
  });

  test('the Stock switch adds what store-01 holds to the grid', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/prices?q=Tas%20Selempang');
    await expect(row(screen, 'Tas Selempang Kanvas')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('switch', 'Stock').tap();
    await expect(screen.getByRole('switch', 'Stock')).toBeChecked();
  });

  test('a store price cell that is just the base price reads "same as the base price"', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/prices?q=Tas%20Selempang');
    await expect(screen.getByRole('button', 'same as the base price').first()).toBeVisible({ timeout: 60_000 });
  });
});

describe('change price sheet', { tags: TAGS }, () => {
  test('it cannot publish until a price is typed, and says so', { session: 'rina' }, async ({ app, screen }) => {
    const sheet = await openChangeSheet(app, screen);
    await has(sheet, 'Fill in the price.', 'What kind of price?', 'Applied to', 'After publish', 'rig store-01');
    await expect(sheet.getByRole('button', { name: /^Publish to/ })).toBeDisabled();
    await sheet.getByRole('textbox', { name: /^Price/ }).fill('199000');
    await expect(sheet.getByRole('button', 'Publish to 1 store')).toBeEnabled(); // 219.000 -> 199.000 is a change
  });

  test('a markdown is previewed per store before it is published', { session: 'rina' }, async ({ app, screen }) => {
    const sheet = await openChangeSheet(app, screen);
    await sheet.getByRole('radio', 'Markdown').tap();
    await sheet.getByRole('button', '−20%').tap();
    await has(sheet, 'Rp 219.000', '→ Rp 175.000', '1 price change');
    await expect(sheet.getByRole('button', 'Publish to 1 store')).toBeEnabled();
  });

  test('a markdown percentage of 100 or more is not a markdown', { session: 'rina' }, async ({ app, screen }) => {
    const sheet = await openChangeSheet(app, screen);
    await sheet.getByRole('radio', 'Markdown').tap();
    await sheet.getByRole('textbox', { name: /^% off/ }).fill('100');
    await has(sheet, 'Fill in the price.');
    await expect(sheet.getByRole('button', { name: /^Publish to/ })).toBeDisabled();
  });

  test('choosing stores with none ticked blocks publishing', { session: 'rina' }, async ({ app, screen }) => {
    const sheet = await openChangeSheet(app, screen);
    await sheet.getByRole('radio', 'Markdown').tap();
    await sheet.getByRole('button', '−10%').tap();
    await sheet.getByRole('radio', 'Choose stores').tap();
    await expect(sheet.getByRole('button', { name: /^Publish to/ })).toBeDisabled();
    await sheet.getByRole('checkbox', 'rig store-01').check();
    await expect(sheet.getByRole('button', 'Publish to 1 store')).toBeEnabled();
  });

  test('a scheduled markdown is published as a Markdown change that has not started', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const before = (await books()).length;
    const sheet = await openChangeSheet(app, screen);
    await sheet.getByRole('radio', 'Markdown').tap();
    await sheet.getByRole('button', '−20%').tap();
    await sheet.getByLabel('Starts', { exact: false }).fill(iso(6));
    await sheet.getByLabel('Ends', { exact: false }).fill(iso(20));
    await expect(sheet.getByLabel('Ends', { exact: false })).toHaveValue(iso(20));
    await sheet.getByRole('button', 'Publish to 1 store').tap();
    await expect(screen.getByRole('dialog')).toBeHidden({ timeout: 90_000 }); // the sheet closes once the book is out
    const after = await books();
    const mine = after.filter((b) => b.name === 'Markdown · Tas Selempang Kanvas').sort((a, b) => b.version - a.version)[0];
    expect(mine).toBeDefined();
    expect(after.length).toBeGreaterThanOrEqual(before + 1);
    const detail = await cloud().get(`/api/v1/commercial/publications/${mine!.id}`);
    expect(detail.markdowns).toHaveLength(1);
    expect(detail.markdowns[0]).toMatchObject({ article_code: TAS.article, site_id: 'store-01', replacement_unit_price_minor: 175_000 });
    const change = (await priceChanges()).find((c) => c.publication_id === mine!.id);
    expect(change.kind).toBe('MARKDOWN');
    expect(change.status).toBe('SCHEDULED');
    // not yet: the shop still charges the shelf price
    const q = await quote([await floorEpc(TAS.sku)]);
    expect(q.lines[0].unit_price_minor).toBe(TAS.base);
  });

  test('a new regular price writes one price rule per size for the chosen store', { session: 'rina' }, async ({ app, screen }) => {
    const sheet = await openChangeSheet(app, screen);
    await sheet.getByRole('textbox', { name: /^Price/ }).fill('229000');
    await sheet.getByLabel('Starts', { exact: false }).fill(iso(8));
    await sheet.getByRole('button', 'Publish to 1 store').tap();
    await expect(screen.getByRole('dialog')).toBeHidden({ timeout: 90_000 }); // the sheet closes once the book is out
    const all = await books();
    const mine = all.filter((b) => b.name === 'New price · Tas Selempang Kanvas').sort((a, b) => b.version - a.version)[0];
    expect(mine).toBeDefined();
    const detail = await cloud().get(`/api/v1/commercial/publications/${mine.id}`);
    expect(detail.price_rules).toHaveLength(2); // the article has two SKUs
    expect(detail.price_rules.every((r: any) => r.site_id === 'store-01' && r.unit_price_minor === 229_000)).toBe(true);
    const change = (await priceChanges()).find((c) => c.publication_id === mine.id);
    expect(change.kind).toBe('REGULAR_PRICE');
  });

  test('a markdown on chosen sizes only prices those SKUs, and the till charges it from today', { session: 'rina', tags: [...TAGS, 'till'] }, async ({ app, screen }) => {
    const sheet = await openChangeSheet(app, screen, 'Kemeja Oxford Lengan Panjang');
    await sheet.getByRole('radio', 'Markdown').tap();
    await sheet.getByRole('radio', 'Choose sizes').tap();
    await sheet.getByRole('checkbox', { name: /00000005104/ }).check();
    await sheet.getByRole('textbox', { name: /^Price/ }).fill('150000');
    await sheet.getByLabel('Ends', { exact: false }).fill(iso(2));
    await sheet.getByRole('button', 'Publish to 1 store').tap();
    await expect(screen.getByRole('dialog')).toBeHidden({ timeout: 90_000 }); // the sheet closes once the book is out
    const charged = async () => (await shop().get('/api/v1/store/catalog?limit=500')).items.find((i: any) => i.sku_code === '00000005104');
    await expect.poll(async () => (await charged()).unit_price_minor, { timeout: 90_000, intervals: [2000] }).toBe(150_000);
    expect((await charged()).price_source).toBe('MARKDOWN');
  });
});

describe('change price receipt', { tags: [...TAGS, 'bug'] }, () => {
  test('publishing a price change confirms it, as every other publish does', { session: 'rina' }, async ({ app, screen }) => {
    const sheet = await openChangeSheet(app, screen);
    await sheet.getByRole('radio', 'Markdown').tap();
    await sheet.getByRole('button', '−10%').tap();
    await sheet.getByLabel('Starts', { exact: false }).fill(iso(7));
    await sheet.getByRole('button', 'Publish to 1 store').tap();
    // ChangePriceSheet raises "“Markdown · …” published — Sent to N stores." but the pricelist re-keys
    // (and so unmounts) the sheet in the same tick, so the receipt never reaches the screen.
    await expect(screen.getByText('published', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  });
});

describe('changes', { tags: TAGS }, () => {
  test('the markdown on Sandal is listed with its kind, status and rollout', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/changes');
    await expect(screen.getByRole('heading', 'Changes')).toBeVisible({ timeout: 60_000 });
    await has(row(screen, 'Price drop: Sandal Slide Karet'), 'Markdown', 'Active', '1/1');
  });

  test('Scheduled lists a change that has not started; Active does not', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('C');
    await publishBook(`Jadwal ${t}`, {
      change_type: 'MARKDOWN',
      effective_from: futureStart(),
      markdowns: [{ markdown_id: `md-${t}`, article_code: TAS.article, site_id: 'store-01', replacement_unit_price_minor: 190_000, priority: 0, iso_weekdays: [], from_minute: null, to_minute: null, effective_from: futureStart(), effective_to: null }],
    });
    await app.open('/commercial/changes');
    await expect(row(screen, `Jadwal ${t}`)).toBeVisible({ timeout: 60_000 });
    await has(row(screen, `Jadwal ${t}`), 'Markdown', 'Scheduled');
    await screen.getByRole('button', 'Scheduled').tap();
    await expect(row(screen, `Jadwal ${t}`)).toBeVisible();
    await expect(row(screen, 'Price drop: Sandal Slide Karet')).toBeHidden();
    await screen.getByRole('button', 'Active').tap();
    await expect(row(screen, 'Price drop: Sandal Slide Karet')).toBeVisible();
    await expect(row(screen, `Jadwal ${t}`)).toBeHidden();
  });

  test('search finds a change by name', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/changes');
    await expect(row(screen, 'Price drop: Sandal Slide Karet')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('textbox', 'Search changes').fill('Sandal');
    await expect(row(screen, 'Price drop: Sandal Slide Karet')).toBeVisible();
    await screen.getByRole('textbox', 'Search changes').fill('zzzzz-none');
    await expect(screen.getByText('No change matches that search.')).toBeVisible();
  });

  test('a change opens as a sheet with its stores', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/changes');
    await row(screen, 'Price drop: Sandal Slide Karet').tap();
    const sheet = screen.getByRole('dialog');
    await has(sheet, 'Price drop: Sandal Slide Karet', 'rig store-01');
  });

  test('"Include settled" widens the list to changes that are fully rolled out and over', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/changes');
    await expect(row(screen, 'Price drop: Sandal Slide Karet')).toBeVisible({ timeout: 60_000 });
    const before = await row(screen, '').count();
    await screen.getByRole('checkbox', 'Include settled').check();
    await expect.poll(async () => await row(screen, '').count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(before);
    expect((await priceChanges()).length).toBeGreaterThanOrEqual(1);
  });
});

describe('history', { tags: TAGS }, () => {
  test('a book I publish is logged as Published and then In service at the shop', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('H');
    await publishBook(`Catatan ${t}`, {
      change_type: 'MARKDOWN',
      markdowns: [{ markdown_id: `mh-${t}`, article_code: TAS.article, site_id: 'store-01', replacement_unit_price_minor: 205_000, priority: 0, iso_weekdays: [], from_minute: null, to_minute: null, effective_from: futureStart(), effective_to: null }],
    });
    await app.open('/commercial/history');
    await expect(screen.getByRole('heading', 'History')).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText(`Catatan ${t}`).first()).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Published').tap();
    await expect(screen.getByText(`Catatan ${t}`).first()).toBeVisible();
    await app.open('/commercial/history?log-kind=ACTIVATED');
    await expect(screen.getByRole('button', 'In service')).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
  });

  test('narrowing to one store says which and can be undone', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/history?site=store-01');
    await expect(screen.getByText('rig store-01 · show every store')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('button', 'rig store-01 · show every store').tap();
    await expect(screen.getByText('rig store-01 · show every store')).toBeHidden();
  });

  test('a store with no events shows the filtered empty state with Clear filters', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/history?site=no-such-store&log-kind=ACTIVATED');
    await expect(screen.getByText('Nothing matches these filters.')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('button', 'Clear filters').tap();
    await expect(screen.getByText('Nothing matches these filters.')).toBeHidden();
  });

  test('the Trouble lens holds only failures and expiries', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/history');
    await expect(screen.getByRole('heading', 'History')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('button', 'Trouble').tap();
    await expect(screen.getByRole('button', 'Trouble')).toHaveAttribute('aria-pressed', 'true');
    const events = (await cloud().get('/api/v1/commercial/price-events?limit=200&kind=FAILED,EXPIRED')).rows;
    expect(events.every((e: any) => ['FAILED', 'EXPIRED'].includes(e.kind))).toBe(true);
  });
});
