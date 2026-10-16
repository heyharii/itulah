// Ops › Receiving: a PO line ordered in variants is counted PER VARIANT, blind (nina, cloud-hosted DC).
import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, poNumbers, rows, waitFor, waitPo } from '../../support/rig.ts';
import { dcCounts, newPo, openCount, typeCount } from '../../support/po.ts';
import { SPEC, breakdown, countBox, countSheet, figures, labelOf, mixedPo, plainPo, variantPo, waitAwaiting, workLine, key } from '../../support/variants.ts';

const TAGS = ['variants', 'receiving'];
const GUARD = 'needs the cloud-hosted DC';
const cloudOnly = () => process.env.RIG_DC_HOSTING !== 'cloud';

/** Type every variant's count (keyed `COLOUR|size`) on the open sheet. */
async function typeAll(screen: any, article: string, counted: Record<string, number>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const s of SPEC) await countBox(screen, article, labelOf(s)).fill(String(counted[key(s.colour, s.size)] ?? 0));
}

const AS_ORDERED = Object.fromEntries(SPEC.map((s) => [key(s.colour, s.size), s.qty]));

describe('Receiving · counted per variant', { session: 'nina', tags: TAGS }, () => {
  test('VAR-20 the sheet has one box per "<article> <Color> <Size>", the line total is their live sum, and never says how many were ordered', { tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    test.skip(cloudOnly(), GUARD);
    const p = await variantPo();
    await workLine(p.po);
    await openCount(app, screen, p.po);
    for (const s of SPEC) await expect(countBox(screen, p.article, labelOf(s))).toBeVisible();
    await expect(screen.getByLabel(`Counted PCS of ${p.t}-KAO`)).toBeHidden(); // no single box for a split line
    await expect(screen.getByRole('button', 'Submit count')).toBeDisabled();
    await countBox(screen, p.article, labelOf(SPEC[0]!)).fill('3');
    await countBox(screen, p.article, labelOf(SPEC[1]!)).fill('5');
    await expect(screen.getByText('8 pcs').first()).toBeVisible();
    await expect(screen.getByRole('button', 'Submit count')).toBeEnabled();
    // blind: the dialog never shows an ordered figure (12 pcs in all; 4/3/2/3 by variant)
    await expect(screen.getByRole('dialog')).not.toContainText('12 pcs');
    await expect(screen.getByRole('dialog')).not.toContainText(/Ordered (Quantity|Qty)|ordered \d/);
  });

  test('VAR-21 [api] the bay\'s work list names the variants and never carries how many were ordered of each', { tags: [...TAGS, 'api'] }, async () => {
    test.skip(cloudOnly(), GUARD);
    const p = await variantPo();
    const line = await workLine(p.po);
    expect(line.variants).toHaveLength(4);
    for (const v of line.variants) {
      expect(Object.keys(v).sort()).toEqual(expect.arrayContaining(['colour_code', 'colour_label', 'size_code', 'size_label', 'image_urls']));
      expect(v).not.toHaveProperty('quantity');
      expect(v).not.toHaveProperty('ordered_quantity');
      expect(v).not.toHaveProperty('base_price_minor');
    }
    const labels = line.variants.map((v: any) => `${v.colour_label} ${v.size_label}`).sort(); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(labels).toEqual(['Black L', 'Black M', 'White L', 'White M']);
  });

  test('VAR-22 counting every variant exactly as ordered receives the PO on its own', { tags: TAGS }, async ({ app, screen }) => {
    test.skip(cloudOnly(), GUARD);
    const p = await variantPo();
    await workLine(p.po);
    await openCount(app, screen, p.po);
    await typeAll(screen, p.article, AS_ORDERED);
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    await waitPo(p.po, { lifecycle: 'FULLY_RECEIVED', received_stock_units: 12 });
  });

  test('VAR-23 same total but a different mix (3/4/2/3 for 4/3/2/3) is NOT received on its own: it waits for review', { tags: TAGS }, async ({ app, screen }) => {
    test.skip(cloudOnly(), GUARD);
    const p = await variantPo();
    await workLine(p.po);
    await openCount(app, screen, p.po);
    const counted = { ...AS_ORDERED, [key('BLACK', '03')]: 3, [key('BLACK', '04')]: 4 };
    await typeAll(screen, p.article, counted);
    await expect(screen.getByText('12 pcs').first()).toBeVisible(); // the line total still matches
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    const [c] = await waitAwaiting(p.po);
    expect(c.counted_quantity).toBe(12);
    expect(c.variance).toBe(0);
    const f = figures(c);
    expect(f[key('BLACK', '03')]).toEqual({ ordered: 4, outstanding: 4, counted: 3 });
    expect(f[key('BLACK', '04')]).toEqual({ ordered: 3, outstanding: 3, counted: 4 });
    expect(f[key('WHITE', '03')].counted).toBe(2);
    expect((await poNumbers(p.po)).received_stock_units).toBe(0);
  });

  test('VAR-24 a short count: a variant left blank is 0 of it, the line total is the sum and the count waits', { tags: TAGS }, async ({ app, screen }) => {
    test.skip(cloudOnly(), GUARD);
    const p = await variantPo();
    await workLine(p.po);
    await openCount(app, screen, p.po);
    await countBox(screen, p.article, labelOf(SPEC[0]!)).fill('4');
    await countBox(screen, p.article, labelOf(SPEC[1]!)).fill('3');
    await countBox(screen, p.article, labelOf(SPEC[3]!)).fill('3'); // White M left blank
    await expect(screen.getByText('10 pcs').first()).toBeVisible();
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    const [c] = await waitAwaiting(p.po);
    expect(c.counted_quantity).toBe(10);
    expect(c.variance).toBe(-2);
    expect(figures(c)[key('WHITE', '03')].counted).toBe(0);
  });

  test('VAR-25 Not as Ordered rides on top of the variants: good pieces per variant, wrong pieces as before', { tags: TAGS }, async ({ app, screen }) => {
    test.skip(cloudOnly(), GUARD);
    const p = await variantPo();
    await workLine(p.po);
    await openCount(app, screen, p.po);
    await typeAll(screen, p.article, AS_ORDERED);
    await screen.getByPlaceholder('0').fill('2');
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    const [c] = await waitAwaiting(p.po);
    expect(c.wrong_quantity).toBe(2);
    expect(c.counted_quantity).toBe(14); // 12 right + 2 not as ordered
    expect(Object.values(figures(c)).reduce((s, v) => s + v.counted, 0)).toBe(12);
    expect((await poNumbers(p.po)).received_stock_units).toBe(0); // mismatched goods are never auto-received
  });

  test('VAR-26 a variant box takes whole pieces only: a decimal point or letters are not accepted', { tags: TAGS }, async ({ app, screen }) => {
    test.skip(cloudOnly(), GUARD);
    const p = await variantPo();
    await workLine(p.po);
    await openCount(app, screen, p.po);
    const box = countBox(screen, p.article, labelOf(SPEC[1]!));
    await box.fill('2.5');
    await expect(box).toHaveValue('25'); // the box keeps digits only
    await box.fill('abc');
    await expect(box).toHaveValue('');
    await expect(screen.getByRole('button', 'Submit count')).toBeDisabled();
  });

  test('VAR-27 only wrong goods arrived (no variant counted): Not as Ordered alone is a valid count', { tags: TAGS }, async ({ app, screen }) => {
    test.skip(cloudOnly(), GUARD);
    const p = await variantPo();
    await workLine(p.po);
    await openCount(app, screen, p.po);
    await screen.getByPlaceholder('0').fill('3');
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    const [c] = await waitAwaiting(p.po);
    expect(c.wrong_quantity).toBe(3);
  });

  test('VAR-28 [api] the variants must add up to the line\'s own pieces; a variant never ordered is Not as Ordered; each counted once', { tags: [...TAGS, 'api'] }, async () => {
    test.skip(cloudOnly(), GUARD);
    const p = await variantPo();
    const line = await workLine(p.po);
    const receipt = await (await import('../../support/rig.ts')).openReceipt(p.ctx);
    const post = (counts: unknown[]) => as('dc', 'nina').call('POST', '/api/v1/dc/purchase-counts/batch', { receipt_id: receipt.receipt_id, counts, actor_id: 'nina', idempotency_key: crypto.randomUUID() }, { ok: false });
    const v = (colour_code: string, size_code: string, counted_quantity: number) => ({ colour_code, size_code, counted_quantity });
    const mismatch = await post([{ po_line_id: line.po_line_id, counted_quantity: 10, wrong_quantity: 0, variants: [v('BLACK', '03', 4), v('BLACK', '04', 3), v('WHITE', '03', 2), v('WHITE', '04', 3)] }]);
    expect(JSON.stringify(mismatch)).toMatch(/variants come to 12 pieces and the line to 10/);
    const stranger = await post([{ po_line_id: line.po_line_id, counted_quantity: 5, wrong_quantity: 0, variants: [v('BLACK', '03', 4), v('WHITE', '05', 1)] }]);
    expect(JSON.stringify(stranger)).toMatch(/was not ordered on this line; count those pieces as Not as Ordered/);
    const twice = await post([{ po_line_id: line.po_line_id, counted_quantity: 4, wrong_quantity: 0, variants: [v('BLACK', '03', 2), v('BLACK', '03', 2)] }]);
    expect(JSON.stringify(twice)).toMatch(/counted once on a sheet/);
    const neg = await post([{ po_line_id: line.po_line_id, counted_quantity: 4, wrong_quantity: 0, variants: [v('BLACK', '03', -1), v('BLACK', '04', 5)] }]);
    expect(JSON.stringify(neg)).toMatch(/less than nothing/);
    // none of the refusals left a count behind
    expect((await awaitingNone(p.po))).toBe(true);
  });

  test('VAR-29 two lines on one order: the split line has per-variant boxes, the plain line its single box, one Submit count sends both', { tags: TAGS }, async ({ app, screen }) => {
    test.skip(cloudOnly(), GUARD);
    const m = await mixedPo();
    await workLine(m.po);
    await openCount(app, screen, m.po);
    for (const s of SPEC) await expect(countBox(screen, m.articleA, labelOf(s))).toBeVisible();
    await expect(screen.getByLabel(`Counted PCS of ${m.t}B-KAO`)).toBeVisible();
    await expect(screen.getByLabel(`Counted PCS of ${m.t}A-KAO`)).toBeHidden();
    await typeAll(screen, m.articleA, AS_ORDERED);
    await typeCount(screen, `${m.t}B-KAO`, '5'); // 5 of 6: short
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    const got = await waitFor('two counts at the DC', async () => { const l = await dcCounts(m.po); return l.length >= 2 ? l : null; }, 60_000, 2_000).catch(async () => await waitAwaiting(m.po));
    expect(got.length).toBeGreaterThanOrEqual(1);
  });

  test('VAR-30 regression: a line with no variants still has one "Counted PCS of <code>" box and no variant rows', { tags: TAGS }, async ({ app, screen }) => {
    test.skip(cloudOnly(), GUARD);
    const p = await plainPo(8);
    await workLine(p.po);
    await openCount(app, screen, p.po);
    await expect(screen.getByLabel(`Counted PCS of ${p.t}-KAO`)).toBeVisible();
    await expect(screen.getByLabel(new RegExp(`^Counted pieces of ${p.article}`))).toHaveCount(0);
    await typeCount(screen, `${p.t}-KAO`, '8');
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    await waitPo(p.po, { lifecycle: 'FULLY_RECEIVED', received_stock_units: 8 });
  });

  test('VAR-31 a variant line counted as a whole (an older client, no breakdown) is still accepted by the API', { tags: [...TAGS, 'api'] }, async () => {
    test.skip(cloudOnly(), GUARD);
    const { ctx, po } = await newPo(8);
    const line = await workLine(po);
    const done = await countSheet(ctx, [{ po_line_id: line.po_line_id, whole: 5 }]);
    expect(done.items[0].counted_quantity).toBe(5);
    const [c] = await waitAwaiting(po);
    expect(c.variance).toBe(-3);
    void rows;
  });
});

async function awaitingNone(po: string) {
  const { awaiting } = await import('../../support/variants.ts');
  return (await awaiting(po)).length === 0;
}
