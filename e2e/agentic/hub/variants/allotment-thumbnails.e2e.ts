// Allotment: a 32px article thumbnail in the New allotment grid, the Unallotted list and the allotment sheet.
// The article is made from a variant PO and carries a picture link, so each thumbnail is a "View the photo of <name>" button.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { allot } from '../../support/outbound.ts';
import { variantStock } from '../../support/variants.ts';

const TAGS = ['variants', 'outbound'];
const TIMEOUT = 900_000;

type Stock = Awaited<ReturnType<typeof variantStock>>;
let shared: Promise<Stock> | undefined;
const stock = () => (shared ??= variantStock(true));

/** Every match of the thumbnail button is a 32px box (the Allotment screens' own size). */
async function expect32(loc: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const box = await loc.first().boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.width)).toBe(32);
  expect(Math.round(box!.height)).toBe(32);
}

describe('Allotment thumbnails', { session: 'rina', tags: TAGS, timeout: TIMEOUT }, () => {
  test('VAR-60 New allotment: the article row carries a 32px thumbnail', { tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const s = await stock();
    await app.open(`/allotment/new?supplier=0001&articles=${s.skus[0]!.article_id}`);
    await expect(screen.getByRole('heading', 'New allotment · Garmen Nusantara, PT')).toBeVisible({ timeout: 60_000 });
    const thumb = screen.getByRole('button', `View the photo of ${s.article}`);
    await expect(thumb.first()).toBeVisible({ timeout: 60_000 });
    await expect32(thumb);
  });

  test('VAR-61 Unallotted: the article row carries a 32px thumbnail', { tags: TAGS }, async ({ app, screen }) => {
    const s = await stock();
    // support/outbound.ts openAllotments still waits for the old "Allotted" tab; the page now has Unallotted · In progress · Completed · Cancelled
    await app.open('/allotment');
    await expect(screen.getByRole('tab', /^Unallotted/)).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('textbox', 'Search supplier, article or order').fill(s.article);
    const thumb = screen.getByRole('button', `View the photo of ${s.article}`);
    await expect(thumb.first()).toBeVisible({ timeout: 90_000 });
    await expect32(thumb);
  });

  test('VAR-62 the allotment sheet: each article line has a 32px thumbnail', { tags: TAGS }, async ({ app, screen }) => {
    const s = await stock();
    const made = await allot([{ sku: s.skus[0]!, store: 'store-01', qty: 1 }], `Uji foto ${s.t}`);
    await app.open(`/allotment?allotment=${made.id}`);
    await expect(screen.getByRole('dialog', new RegExp(`^${made.allotment_number}`))).toBeVisible({ timeout: 60_000 });
    const thumb = screen.getByRole('button', `View the photo of ${s.article}`);
    await expect(thumb.first()).toBeVisible({ timeout: 90_000 });
    await expect32(thumb);
  });

  test('VAR-63 tapping a thumbnail shows the photo full size', { tags: TAGS }, async ({ app, screen }) => {
    const s = await stock();
    await app.open(`/allotment/new?supplier=0001&articles=${s.skus[0]!.article_id}`);
    await screen.getByRole('button', `View the photo of ${s.article}`).first().tap({ timeout: 90_000 } as never);
    await expect(screen.getByRole('dialog', `Photo of ${s.article}`)).toBeVisible();
    await screen.getByRole('button', 'Close photo').tap();
    await expect(screen.getByRole('dialog', `Photo of ${s.article}`)).toBeHidden();
  });
});
