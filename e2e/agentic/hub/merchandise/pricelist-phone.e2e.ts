// Marketing › Pricelist on a phone (414 x 896): the dock's status chip switches Pricelist | Final price; each card
// reads the base price with its cost and the markup % over that cost. (The desk grid is covered by hub/marketing.)
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { viewports } from '../../support/base.ts';
import { articleDetail, cloudCall, rupiah, sharedArticle, SLOW, type NewArticle } from '../../support/merchandise.ts';

const TAGS = ['merchandise', 'pricelist'];
let mine: NewArticle;

async function openPhone(app: any, screen: any, browser: any, q: string) {
  await browser.setViewport(viewports.phone);
  await app.open(`/commercial/prices?q=${encodeURIComponent(q)}`);
  await expect(screen.getByText(q, { exact: false }).first()).toBeVisible({ timeout: 90_000 });
}

async function use() {
  const a = await sharedArticle();
  mine = { ...a, name: (await articleDetail(a.code)).name };
}

describe('Pricelist on a phone', { session: 'rina', tags: TAGS, timeout: 700_000 }, () => {
  test('MER-170 the dock opens on Final price and the status sheet offers Pricelist | Final price', { tags: [...TAGS, 'smoke'] }, async ({ app, screen, browser }) => {
    await use();
    await openPhone(app, screen, browser, mine.name);
    await expect(screen.getByRole('button', 'Status: Final price')).toBeVisible();
    await screen.getByRole('button', 'Status: Final price').tap();
    await expect(screen.getByRole('button', 'Pricelist')).toBeVisible();
    await expect(screen.getByRole('button', 'Final price')).toHaveAttribute('aria-pressed', 'true');
    await screen.getByRole('button', 'Pricelist').tap();
    await expect(screen.getByRole('button', 'Status: Pricelist')).toBeVisible(SLOW);
    await expect(screen.getByText(mine.name, { exact: false }).first()).toBeVisible();
  });

  test('MER-171 the card reads the base price, the cost and the markup % over cost', { tags: TAGS }, async ({ app, screen, browser }) => {
    await use();
    await openPhone(app, screen, browser, mine.name);
    await expect(screen.getByText(rupiah(99_000), { exact: false }).first()).toBeVisible(SLOW);
    // 99.000 over a cost of 40.000 is a 147,5 % markup
    await expect(screen.getByText(`Cost ${rupiah(40_000)}`, { exact: false }).first()).toBeVisible(SLOW);
    await expect(screen.getByText(/Markup 147[,.]5\s?%/).first()).toBeVisible();
  });

  test('MER-172 switching to Pricelist asks the server for the listed price and Final price for the till price', { tags: [...TAGS, 'api'] }, async () => {
    await use();
    const listed = await cloudCall('GET', `/api/v1/commercial/article-prices?channel=STORE&q=${encodeURIComponent(mine.name)}&limit=5`);
    const final = await cloudCall('GET', `/api/v1/commercial/article-prices?channel=STORE&final=true&q=${encodeURIComponent(mine.name)}&limit=5`);
    expect(listed.status, JSON.stringify(listed.body).slice(0, 200)).toBe(200);
    expect(final.status).toBe(200);
    const row = (final.body.rows ?? final.body.items ?? []).find((r: any) => r.article_code === mine.code);
    expect(row, 'the new article is priced').toBeDefined();
  });
});
