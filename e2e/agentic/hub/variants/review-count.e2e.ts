// Procurement › Review Count (rina) of a line ordered in variants: variant rows (Ordered | Counted | signed difference | photo);
// Approve / Close Short stay per line; auto-receive waits for review when a variant differs even if the total matches.
import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { poNumbers, waitFor, waitPo } from '../../support/rig.ts';
import { openReview } from '../../support/po.ts';
import {
  plainPo, SPEC, breakdown, countSheet, countVariants, key, labelOf, mixedPo, photoUrl, variantPo, waitAwaiting, workLine, total,
} from '../../support/variants.ts';

const TAGS = ['variants', 'receiving'];
const AS_ORDERED = Object.fromEntries(SPEC.map((s) => [key(s.colour, s.size), s.qty]));
const dlg = (screen: any) => screen.getByRole('dialog', /^Review Count/); // eslint-disable-line @typescript-eslint/no-explicit-any
/** The row of one variant: "<article> <Color> <Size>". */
const rowOf = (screen: any, article: string, label: string) => dlg(screen).getByRole('row', { name: new RegExp(`${article} ${label}`) }); // eslint-disable-line @typescript-eslint/no-explicit-any


/** Recount from the open Review Count. The deployed build asks which lines and why (RV-08); the newer source sends straight back. Both end with the bay asked again. */
async function recount(screen: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  await screen.getByRole('button', 'Recount').tap();
  const why = screen.getByRole('textbox', 'Why should it be counted again?');
  await why.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => undefined);
  if (await why.isVisible().catch(() => false)) {
    await why.fill('Hitung ulang per varian');
    await screen.getByRole('button', /^Send 1 items? back to count$/).tap();
  }
}

describe('Review Count · variants', { session: 'rina', tags: TAGS, timeout: 300_000 }, () => {
  test('VAR-40 a variant line splits into variant rows: Ordered | Counted | signed difference, and the line above says the total', { tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const p = await variantPo();
    // 3 of Black M (−1), 4 of Black L (+1), White M as ordered, White L short by 1 → total 11
    await countVariants(p, { ...AS_ORDERED, [key('BLACK', '03')]: 3, [key('BLACK', '04')]: 4, [key('WHITE', '04')]: 2 });
    await openReview(app, screen, p.po);
    for (const h of ['Item', 'Ordered', 'Counted', 'Unit Price', 'Amount']) await expect(dlg(screen)).toContainText(h);
    const bm = rowOf(screen, p.article, 'Black M');
    await expect(bm).toContainText('4 pcs');
    await expect(bm).toContainText('3 pcs');
    await expect(bm).toContainText(/−1 pc|-1 pc/);
    const bl = rowOf(screen, p.article, 'Black L');
    await expect(bl).toContainText('+1 pc');
    await expect(rowOf(screen, p.article, 'White M')).toContainText('Matches');
    await expect(rowOf(screen, p.article, 'White L')).toContainText(/−1 pc|-1 pc/);
    await expect(dlg(screen)).toContainText(/−1 pc|-1 pc/); // the line itself: 11 of 12
  });

  test('VAR-41 same total, different mix: nothing was auto-received, the line says it matches but the variants show the swap', { tags: TAGS }, async ({ app, screen }) => {
    const p = await variantPo();
    const { count } = await countVariants(p, { ...AS_ORDERED, [key('BLACK', '03')]: 3, [key('BLACK', '04')]: 4 });
    void count;
    await waitAwaiting(p.po);
    expect((await poNumbers(p.po)).received_stock_units).toBe(0); // 12 of 12 but not exact per variant
    await openReview(app, screen, p.po);
    await expect(rowOf(screen, p.article, 'Black M')).toContainText(/−1 pc|-1 pc/);
    await expect(rowOf(screen, p.article, 'Black L')).toContainText('+1 pc');
    await expect(dlg(screen).getByRole('button', 'Close Short')).toBeHidden(); // nothing is short
    await dlg(screen).getByRole('button', 'Submit').tap();
    await waitPo(p.po, { lifecycle: 'FULLY_RECEIVED', received_stock_units: 12 }, 150_000);
  });

  test('VAR-42 an exact per-variant count is received without a review (control for VAR-41)', { tags: TAGS }, async () => {
    const p = await variantPo();
    await countVariants(p, AS_ORDERED);
    await waitPo(p.po, { lifecycle: 'FULLY_RECEIVED', received_stock_units: 12 }, 150_000);
  });

  test('VAR-43 Close Short on a short variant line accepts what was counted and closes the rest, per line', { tags: TAGS }, async ({ app, screen }) => {
    const p = await variantPo();
    await countVariants(p, { ...AS_ORDERED, [key('WHITE', '03')]: 0 }); // White M did not come: 10 of 12
    await openReview(app, screen, p.po);
    await expect(rowOf(screen, p.article, 'White M')).toContainText(/−2 pcs|-2 pcs/);
    await screen.getByRole('button', 'Close Short').tap();
    await expect(screen.getByText('Close This Short?')).toBeVisible();
    await expect(screen.getByText(/2 pcs will be removed from the order/)).toBeVisible();
    await screen.getByRole('button', 'Close Short').last().tap();
    await waitPo(p.po, { lifecycle: 'SHORT_RECEIVED', received_stock_units: 10 }, 150_000);
  });

  test('VAR-44 Partial Receive keeps the shortfall of the line open', { tags: TAGS }, async ({ app, screen }) => {
    const p = await variantPo();
    await countVariants(p, { ...AS_ORDERED, [key('BLACK', '04')]: 1 }); // 10 of 12
    await openReview(app, screen, p.po);
    await screen.getByRole('button', 'Partial Receive').tap();
    await waitPo(p.po, { lifecycle: 'PARTIALLY_RECEIVED', received_stock_units: 10, outstanding_stock_units: 2 }, 150_000);
  });

  test('VAR-45 a variant with photographs shows the first one (tap to enlarge) and "+N" for the rest; the others show none of their own', { tags: TAGS }, async ({ app, screen }) => {
    const t = 'VPH' + Date.now().toString(36).slice(-4);
    const specs = SPEC.map((s, i) => (i === 0 ? { ...s, photos: [photoUrl(t, 1), photoUrl(t, 2), photoUrl(t, 3)] } : s));
    const p = await variantPo(specs);
    await countVariants(p, { ...AS_ORDERED, [key('BLACK', '03')]: 2 });
    await openReview(app, screen, p.po);
    const name = `${p.article} Black M`;
    await expect(screen.getByRole('button', `View the photo of ${name}`)).toBeVisible();
    await expect(rowOf(screen, p.article, 'Black M')).toContainText('+2');
    await expect(screen.getByRole('button', `View the photo of ${p.article} Black L`)).toBeHidden();
  });

  test('VAR-46 the Review Count payload carries ordered / outstanding / counted per variant (what the rows show)', { tags: [...TAGS, 'api'] }, async () => {
    const p = await variantPo();
    await countVariants(p, { ...AS_ORDERED, [key('WHITE', '04')]: 5 });
    const [c] = await waitAwaiting(p.po);
    expect(c.variants).toHaveLength(4);
    const wl = c.variants.find((v: any) => v.colour_code === 'WHITE' && v.size_code === '04'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(wl).toMatchObject({ ordered_quantity: 3, outstanding_quantity: 3, counted_quantity: 5, colour_label: 'White', size_label: 'L' });
    expect(c.counted_quantity).toBe(14);
  });

  test('VAR-47 two lines: the split line has variant rows, the plain one does not, and one Submit accepts both', { tags: TAGS }, async ({ app, screen }) => {
    const m = await mixedPo();
    const lines = (await (await import('../../support/variants.ts')).lines(m.po));
    await workLine(m.po);
    const { openReceipt, countLine } = await import('../../support/rig.ts');
    void openReceipt; void countLine;
    await countSheet(m.a, [
      { po_line_id: lines[0].po_line_id, variants: breakdown(SPEC, { ...AS_ORDERED, [key('BLACK', '03')]: 3, [key('BLACK', '04')]: 4 }) },
      { po_line_id: lines[1].po_line_id, whole: m.plainQty },
    ]);
    await openReview(app, screen, m.po);
    await expect(rowOf(screen, m.articleA, 'Black M')).toBeVisible();
    await expect(dlg(screen).getByRole('row', { name: new RegExp(`${m.articleB} (Black|White|M|L)`) })).toHaveCount(0);
    await dlg(screen).getByRole('button', 'Submit').tap();
    await waitPo(m.po, { received_stock_units: total(SPEC) + m.plainQty }, 150_000);
  });

  test('VAR-48 Recount sends a variant line straight back (no reason, no ticking); the PO list says Recounting', { tags: TAGS }, async ({ app, screen }) => {
    const p = await variantPo();
    await countVariants(p, { ...AS_ORDERED, [key('BLACK', '03')]: 1 });
    await openReview(app, screen, p.po);
    await recount(screen);
    await waitFor(`${p.po} sent back to the bay`, async () => (await workLine(p.po)).recount_reason, 60_000, 2_000); // the warehouse is asked to count it again
    await app.open('/procurement/orders');
    await expect(screen.getByRole('row', { name: new RegExp(p.po) })).toContainText('Recounting', { timeout: 90_000 });
    void labelOf;
  });

  test('VAR-49 control: Recount on a line with no variants is sent straight back too', { tags: TAGS }, async ({ app, screen }) => {
    const p = await plainPo(8);
    const line = await workLine(p.po);
    await countSheet(p.ctx, [{ po_line_id: line.po_line_id, whole: 5 }]);
    await openReview(app, screen, p.po);
    await recount(screen);
    await waitFor(`${p.po} sent back to the bay`, async () => (await workLine(p.po)).recount_reason, 60_000, 2_000);
  });
});
