// Master › New Articles: the colour × size grid is pre-filled from the PO's variants — the COUNTED quantity per variant
// when the bay counted per variant, else the ordered one; variant photos small in their cells, the first photo of each
// colour at the colour row head.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { cloudCall, SLOW } from '../../support/merchandise.ts';
import { SPEC, deliveredVariantPo, key, labelOf, photoUrl, total } from '../../support/variants.ts';

const TAGS = ['variants', 'merchandise', 'new-articles'];

async function open(app: any, screen: any, receiptLineId: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  await app.open(`/master/new-articles?receipt=${receiptLineId}`);
  await expect(screen.getByRole('dialog').getByRole('button', 'Submit')).toBeVisible({ timeout: 90_000 });
}
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// the sheet title-cases the name it shows ("Kaos Uji Vp0cckk"), so the labels are matched without case
const cell = (screen: any, article: string, label: string) => screen.getByLabel(new RegExp(`^${esc(article)} ${label} pieces$`, 'i')); // eslint-disable-line @typescript-eslint/no-explicit-any

describe('New Articles · grid from the PO variants', { session: 'rina', tags: TAGS, timeout: 700_000 }, () => {
  test('VAR-50 the grid starts at the COUNTED quantity of each variant when the bay counted per variant', { tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const counted = { [key('BLACK', '03')]: 3, [key('BLACK', '04')]: 4, [key('WHITE', '03')]: 2, [key('WHITE', '04')]: 3 }; // ordered 4/3/2/3
    const d = await deliveredVariantPo(SPEC, counted);
    await open(app, screen, d.waiting.receipt_line_id);
    const sheet = screen.getByRole('dialog');
    const name = d.waiting.article_name as string;
    expect(d.waiting.variants.find((v: any) => v.colour_code === 'BLACK' && v.size_code === '03').counted_quantity).toBe(3); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const s of SPEC) await expect(cell(sheet, name, labelOf(s))).toHaveValue(String(counted[key(s.colour, s.size)]));
    await expect(sheet).toContainText('12 of 12 · 4 SKUs');
  });

  test('VAR-51 a short count starts the grid at what was counted (0 for a variant that did not come), not at the order', { tags: TAGS }, async ({ app, screen }) => {
    const counted = { [key('BLACK', '03')]: 4, [key('BLACK', '04')]: 3, [key('WHITE', '03')]: 0, [key('WHITE', '04')]: 3 };
    const d = await deliveredVariantPo(SPEC, counted);
    await open(app, screen, d.waiting.receipt_line_id);
    const sheet = screen.getByRole('dialog');
    const name = d.waiting.article_name as string;
    await expect(cell(sheet, name, 'Black M')).toHaveValue('4');
    await expect(cell(sheet, name, 'White M')).toHaveValue(/^0?$/);
    await expect(sheet).toContainText(`${total(SPEC) - 2} of ${total(SPEC) - 2}`);
  });

  test('VAR-52 a line counted as a whole (no breakdown) falls back to the ORDERED quantity per variant', { tags: TAGS }, async ({ app, screen }) => {
    const d = await deliveredVariantPo(SPEC, undefined, { whole: true });
    await open(app, screen, d.waiting.receipt_line_id);
    const sheet = screen.getByRole('dialog');
    const name = d.waiting.article_name as string;
    for (const s of SPEC) await expect(cell(sheet, name, labelOf(s))).toHaveValue(String(s.qty));
  });

  test('VAR-53 variant photos sit small in their cells ("+N" for more) and the first photo of each colour heads its row', { tags: TAGS }, async ({ app, screen }) => {
    const t = 'VNA' + Date.now().toString(36).slice(-4);
    const specs = SPEC.map((s, i) =>
      i === 1 ? { ...s, photos: [photoUrl(t, 1), photoUrl(t, 2)] } // Black L: two photos, Black has no photo on Black M
        : i === 2 ? { ...s, photos: [photoUrl(t, 3)] } // White M: one
          : s);
    const d = await deliveredVariantPo(specs);
    await open(app, screen, d.waiting.receipt_line_id);
    const sheet = screen.getByRole('dialog');
    const name = d.waiting.article_name as string;
    // cell photos
    await expect(sheet.getByRole('button', new RegExp(`^View the photo of ${esc(name)} Black L$`, 'i'))).toBeVisible();
    await expect(sheet.getByRole('button', new RegExp(`^View the photo of ${esc(name)} White M$`, 'i'))).toBeVisible();
    await expect(sheet.getByRole('button', new RegExp(`^View the photo of ${esc(name)} Black M$`, 'i'))).toBeHidden();
    await expect(sheet.getByText('+1', { exact: true })).toBeVisible();
    // colour row heads: Black's first photo (from Black L), White's (from White M)
    await expect(sheet.getByRole('button', 'View the photo of Black')).toBeVisible();
    await expect(sheet.getByRole('button', 'View the photo of White')).toBeVisible();
    const ph = await sheet.getByRole('button', new RegExp(`^View the photo of ${esc(name)} Black L$`, 'i')).boundingBox();
    expect(ph!.width).toBeLessThanOrEqual(32);
  });

  test('VAR-54 with no photos on the order the grid shows none in cells or at the colour heads', { tags: TAGS }, async ({ app, screen }) => {
    const d = await deliveredVariantPo();
    await open(app, screen, d.waiting.receipt_line_id);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('button', 'View the photo of Black')).toBeHidden();
    await expect(sheet.getByRole('button', /^View the photo of .* (Black|White) (M|L)$/)).toHaveCount(0);
  });

  test('VAR-55 [api] the unidentified line carries every variant with its photos and counted figure', { tags: [...TAGS, 'api'] }, async () => {
    const t = 'VNB' + Date.now().toString(36).slice(-4);
    const specs = SPEC.map((s, i) => (i === 0 ? { ...s, photos: [photoUrl(t, 1)] } : s));
    const d = await deliveredVariantPo(specs, { [key('BLACK', '03')]: 4, [key('BLACK', '04')]: 3, [key('WHITE', '03')]: 2, [key('WHITE', '04')]: 3 });
    const bm = d.waiting.variants.find((v: any) => v.colour_code === 'BLACK' && v.size_code === '03'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(bm.image_urls).toEqual([photoUrl(t, 1)]);
    expect(bm.counted_quantity).toBe(4);
    expect(bm.quantity).toBe(4);
    void cloudCall; void SLOW;
  });
});
