// New PO › Add item with colours and sizes (variants): the fields, the table, the footer, the wire.
// Owner's decisions of 10 Oct 2026: Colors / Sizes show at once and are optional; with either chosen the single
// Quantity | Price become "Purchase Price" (one price per piece for the whole line) + a Variant | Photos | Quantity table.
import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, poDetail, poNumbers, tag } from '../../support/rig.ts';
import { CODE_LABEL, variantPo, photoUrl, postPo, lines, openAddItem, nameItem, pickColours, pickSizes, variantBox, submitOrder, SPEC } from '../../support/variants.ts';
import { makeItemFast } from '../../support/po.ts';

const TAGS = ['variants', 'po'];

describe('PO variants · Add item', { session: 'rina', tags: TAGS }, () => {
  test('VAR-01 Colors and Sizes show at once on Add item, both optional, with Quantity and Price still there', { tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await openAddItem(app, screen);
    await expect(screen.getByRole('combobox', 'Colors')).toBeVisible();
    await expect(screen.getByRole('combobox', 'Sizes')).toBeVisible();
    // optional: no "required" mark on either, while the Name is marked
    expect(await screen.getByRole('combobox', 'Colors').getAttribute('aria-required')).not.toBe('true');
    expect(await screen.getByRole('combobox', 'Sizes').getAttribute('aria-required')).not.toBe('true');
    await expect(screen.getByRole('textbox', 'Quantity to order')).toBeVisible();
    await expect(screen.getByRole('textbox', 'Price')).toBeVisible();
    await expect(screen.getByRole('textbox', 'Purchase Price')).toBeHidden();
    await expect(screen.getByText('Variant', { exact: true })).toBeHidden();
  });

  test('VAR-02 choosing colours and sizes swaps Quantity | Price for "Purchase Price" and a Variant | Photos | Quantity table', { tags: TAGS }, async ({ app, screen }) => {
    const name = `Kaos ${tag()}`;
    await openAddItem(app, screen);
    await nameItem(screen, name);
    await pickColours(screen, ['Black', 'White']);
    await pickSizes(screen, ['M', 'L']);
    await expect(screen.getByRole('textbox', 'Purchase Price')).toBeVisible();
    await expect(screen.getByRole('textbox', 'Quantity to order')).toBeHidden();
    await expect(screen.getByRole('textbox', 'Price')).toBeHidden();
    for (const h of ['Variant', 'Photos', 'Quantity']) await expect(screen.getByRole('columnheader', h)).toBeVisible();
    // the rows are labelled "<article name> <Color> <Size>"
    for (const v of ['Black M', 'Black L', 'White M', 'White L']) await expect(screen.getByRole('cell', `${name} ${v}`)).toBeVisible();
    await expect(screen.getByRole('row')).toHaveCount(await screen.getByRole('row').count()); // rows exist (settles the table)
  });

  test('VAR-03 the footer counts SKUs with a quantity and adds up the pieces; empty rows do not count', { tags: TAGS }, async ({ app, screen }) => {
    const name = `Kaos ${tag()}`;
    await openAddItem(app, screen);
    await nameItem(screen, name);
    await pickColours(screen, ['Black', 'White']);
    await pickSizes(screen, ['M', 'L']);
    await expect(screen.getByRole('cell', '0 SKUs')).toBeVisible();
    await variantBox(screen, 'BLACK', '03').fill('4');
    await variantBox(screen, 'BLACK', '04').fill('3');
    await expect(screen.getByRole('cell', '2 SKUs')).toBeVisible();
    await expect(screen.getByRole('cell', '7', { exact: true })).toBeVisible();
    await variantBox(screen, 'WHITE', '03').fill('2');
    await variantBox(screen, 'WHITE', '04').fill('3');
    await expect(screen.getByRole('cell', '4 SKUs')).toBeVisible();
    await expect(screen.getByRole('cell', '12', { exact: true })).toBeVisible();
    await variantBox(screen, 'WHITE', '04').fill('0');
    await expect(screen.getByRole('cell', '3 SKUs')).toBeVisible();
    await expect(screen.getByRole('cell', '9', { exact: true })).toBeVisible();
  });

  test('VAR-04 colours alone give one row per colour, sizes alone one row per size', { tags: TAGS }, async ({ app, screen }) => {
    const name = `Kaos ${tag()}`;
    await openAddItem(app, screen);
    await nameItem(screen, name);
    await pickColours(screen, ['Black', 'White']);
    await expect(screen.getByRole('cell', `${name} Black`)).toBeVisible();
    await expect(screen.getByRole('cell', `${name} White`)).toBeVisible();
    await expect(screen.getByRole('cell', `${name} Black M`)).toBeHidden();
    await screen.getByRole('button', 'Remove Black').tap();
    await screen.getByRole('button', 'Remove White').tap();
    await expect(screen.getByRole('textbox', 'Quantity to order')).toBeVisible();
    await pickSizes(screen, ['M', 'L']);
    await expect(screen.getByRole('cell', `${name} M`)).toBeVisible();
    await expect(screen.getByRole('cell', `${name} L`)).toBeVisible();
  });

  test('VAR-05 no Markup and no Base Price on a purchase order, even with variants', { tags: TAGS }, async ({ app, screen }) => {
    const name = `Kaos ${tag()}`;
    await openAddItem(app, screen);
    await nameItem(screen, name);
    await pickColours(screen, ['Black']);
    await pickSizes(screen, ['M']);
    await expect(screen.getByRole('textbox', 'Purchase Price')).toBeVisible();
    await expect(screen.getByRole('textbox', 'Markup')).toBeHidden();
    await expect(screen.getByRole('textbox', { name: /^Base Price/ })).toBeHidden();
    await expect(screen.getByRole('columnheader', 'Price / Pc')).toBeHidden();
  });

  test('VAR-06 every variant row has an optional photo button, "Add photos of <variant>"; none is required', { tags: TAGS }, async ({ app, screen, browser }) => {
    const name = `Kaos ${tag()}`;
    await openAddItem(app, screen);
    await nameItem(screen, name);
    await pickColours(screen, ['Black']);
    await pickSizes(screen, ['M', 'L']);
    for (const v of ['Black M', 'Black L']) {
      await expect(browser.locator(`label[title="Add photos of ${name} ${v}"]`)).toHaveCount(1);
      // a multi-file picker: the owner's rule is "many"
      await expect(browser.locator(`label[title="Add photos of ${name} ${v}"] input[type=file][multiple]`)).toHaveCount(1);
    }
    // nothing is demanded of the photos: the sheet can be sent with none
    await screen.getByRole('textbox', 'Purchase Price').fill('55000');
    await variantBox(screen, 'BLACK', '03').fill('2');
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('button', `Edit ${name}`)).toBeVisible();
  });

  test('VAR-07 [bug] Submit with variants chosen but no quantity says "Fill in how many.", and a missing price "Fill in the price."', { tags: [...TAGS, 'bug'] }, async ({ app, screen }) => {
    const name = `Kaos ${tag()}`;
    await openAddItem(app, screen);
    await nameItem(screen, name);
    await pickColours(screen, ['Black', 'White']);
    await pickSizes(screen, ['M']);
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('Fill in the price.')).toBeVisible();
    // the sheet refuses (no quantity), but on a split line the Quantity box is gone and the sentence with it
    await expect(screen.getByText('Fill in how many.')).toBeVisible();
    await expect(screen.getByRole('button', `Edit ${name}`)).toBeHidden();
  });

  test('VAR-08 a whole order through the form: lines of 4/3/2/3 at one purchase price, the server numbers it and keeps the split', { tags: TAGS, timeout: 300_000 }, async ({ app, screen }) => {
    const t = tag();
    const name = `Kaos ${t}`;
    const { fillHeader, openComposer } = await import('../../support/po.ts');
    await openComposer(app, screen);
    await fillHeader(screen);
    await screen.getByRole('button', 'New item').tap();
    await nameItem(screen, name);
    await pickColours(screen, ['Black', 'White']);
    await pickSizes(screen, ['M', 'L']);
    await screen.getByRole('textbox', 'Purchase Price').fill('55000');
    for (const s of SPEC) await variantBox(screen, s.colour, s.size).fill(String(s.qty));
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('button', `Edit ${name}`)).toBeVisible();
    // the composer line lists its variants under it, each with its pieces
    for (const s of SPEC) await expect(screen.getByRole('row', { name: new RegExp(`^${CODE_LABEL[s.colour]} ${CODE_LABEL[s.size]} ${s.qty} pcs$`) })).toBeVisible();
    const po = await submitOrder(screen);
    const n = await poNumbers(po);
    expect(n.expected_stock_units).toBe(12);
    const [line] = await lines(po);
    expect(line.ordered_quantity ?? line.quantity).toBe(12);
    expect(line.variants).toHaveLength(4);
    const byKey = Object.fromEntries(line.variants.map((v: any) => [`${v.colour_code}|${v.size_code}`, v])); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const s of SPEC) expect(byKey[`${s.colour}|${s.size}`].quantity).toBe(s.qty);
    // one purchase price for the line; no selling price per variant on a PO
    for (const v of line.variants) expect(v.base_price_minor ?? null).toBeNull();
    expect(line.unit_price_minor).toBe(55_000);
  });

  test('VAR-09 [api] the variants of a line must add up to the line quantity', { tags: [...TAGS, 'api'] }, async () => {
    const ctx = await makeItemFast(tag('VS'));
    const bad = await postPo(ctx, [{
      supplier_item_id: ctx.item.supplier_item_id, quantity: 10, promised_date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
      unit_price_minor: null, article_name: null, image_url: null, division_code: null, tags: null, base_price_minor: null, markup_bps: null,
      variants: SPEC.map((v) => ({ colour_code: v.colour, size_code: v.size, quantity: v.qty, base_price_minor: null, image_urls: [] })), // 12, not 10
    }], 'Uji jumlah salah', false);
    expect(JSON.stringify(bad)).toMatch(/add up to 12, not the 10/);
  });

  test('VAR-10 [api] a variant needs a positive quantity, a colour or a size, and appears once', { tags: [...TAGS, 'api'] }, async () => {
    const ctx = await makeItemFast(tag('VR'));
    const base = { supplier_item_id: ctx.item.supplier_item_id, promised_date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), unit_price_minor: null, article_name: null, image_url: null, division_code: null, tags: null, base_price_minor: null, markup_bps: null };
    const v = (o: object) => ({ colour_code: 'BLACK', size_code: '03', quantity: 2, base_price_minor: null, image_urls: [], ...o });
    const zero = await postPo(ctx, [{ ...base, quantity: 2, variants: [v({ quantity: 0 })] }], 'Uji nol', false);
    expect(JSON.stringify(zero)).toMatch(/positive quantity/);
    const none = await postPo(ctx, [{ ...base, quantity: 2, variants: [v({ colour_code: null, size_code: null })] }], 'Uji kosong', false);
    expect(JSON.stringify(none)).toMatch(/colour, a size or both/);
    const twice = await postPo(ctx, [{ ...base, quantity: 4, variants: [v({}), v({})] }], 'Uji dobel', false);
    expect(JSON.stringify(twice)).toMatch(/appears twice/);
  });

  test('VAR-11 [api] a colour alone and a size alone are valid variants', { tags: [...TAGS, 'api'] }, async () => {
    const ctx = await makeItemFast(tag('VC'));
    const base = { supplier_item_id: ctx.item.supplier_item_id, promised_date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), unit_price_minor: null, article_name: null, image_url: null, division_code: null, tags: null, base_price_minor: null, markup_bps: null };
    const colourOnly = await postPo(ctx, [{ ...base, quantity: 5, variants: [
      { colour_code: 'BLACK', size_code: null, quantity: 2, base_price_minor: null, image_urls: [] },
      { colour_code: 'WHITE', size_code: null, quantity: 3, base_price_minor: null, image_urls: [] },
    ] }], 'Uji warna saja');
    expect(colourOnly.po_number).toMatch(/^PO-/);
    const ctx2 = await makeItemFast(tag('VZ'));
    const sizeOnly = await postPo(ctx2, [{ ...base, supplier_item_id: ctx2.item.supplier_item_id, quantity: 5, variants: [
      { colour_code: null, size_code: '03', quantity: 2, base_price_minor: null, image_urls: [] },
      { colour_code: null, size_code: '04', quantity: 3, base_price_minor: null, image_urls: [] },
    ] }], 'Uji ukuran saja');
    expect(sizeOnly.po_number).toMatch(/^PO-/);
  });

  test('VAR-12 [api] a variant keeps its photographs in the order added; more than 12 or a non-link is refused', { tags: [...TAGS, 'api'] }, async () => {
    const t = tag('VH');
    const specs = SPEC.map((s, i) => (i === 0 ? { ...s, photos: [photoUrl(t, 1), photoUrl(t, 2), photoUrl(t, 3)] } : s));
    const p = await variantPo(specs, { notes: `Uji foto ${t}` });
    const [line] = await lines(p.po);
    const first = line.variants.find((v: any) => v.colour_code === 'BLACK' && v.size_code === '03'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(first.image_urls).toEqual([photoUrl(t, 1), photoUrl(t, 2), photoUrl(t, 3)]);
    for (const v of line.variants.filter((x: any) => x !== first)) expect(v.image_urls ?? []).toEqual([]); // eslint-disable-line @typescript-eslint/no-explicit-any
    // twelve is the ceiling
    const mk = async (n: number, urls?: string[]) => {
      const ctx = await makeItemFast(tag('VT'));
      return postPo(ctx, [{
        supplier_item_id: ctx.item.supplier_item_id, quantity: 2, promised_date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
        unit_price_minor: null, article_name: null, image_url: null, division_code: null, tags: null, base_price_minor: null, markup_bps: null,
        variants: [{ colour_code: 'BLACK', size_code: '03', quantity: 2, base_price_minor: null, image_urls: urls ?? Array.from({ length: n }, (_, i) => photoUrl(t, i)) }],
      }], 'Uji batas foto', n <= 12 && !urls);
    };
    expect((await mk(12)).po_number).toMatch(/^PO-/);
    expect(JSON.stringify(await mk(13))).toMatch(/more than 12 photographs/);
    expect(JSON.stringify(await mk(0, ['not-a-link']))).toMatch(/not a link/);
  });

  test('VAR-13 an order edited after the photos were attached keeps them (Edit reopens the variants with their photos)', { tags: TAGS, timeout: 300_000 }, async ({ app, screen, browser }) => {
    const t = tag('VE');
    const specs = SPEC.map((s, i) => (i === 1 ? { ...s, photos: [photoUrl(t, 1), photoUrl(t, 2)] } : s));
    const p = await variantPo(specs, { notes: `Uji ubah ${t}` });
    const d = await poDetail(p.po);
    await app.open(`/procurement/orders?order=${d.purchase_order_id}`);
    const sheet = screen.getByRole('dialog', new RegExp(p.po));
    await expect(sheet).toBeVisible({ timeout: 45_000 });
    await sheet.getByRole('button', 'Edit').tap();
    await expect(screen.getByText(`Edit ${p.po}`)).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('textbox', 'Notes').fill(`diubah ${t}`);
    await screen.getByRole('button', 'Review order').tap();
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText(`${p.po} updated`)).toBeVisible({ timeout: 30_000 });
    const [line] = await lines(p.po);
    const second = line.variants.find((v: any) => v.colour_code === 'BLACK' && v.size_code === '04'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(second.image_urls).toEqual([photoUrl(t, 1), photoUrl(t, 2)]);
    expect(line.variants.map((v: any) => v.quantity).sort()).toEqual([2, 3, 3, 4]); // eslint-disable-line @typescript-eslint/no-explicit-any
    void as; void browser;
  });
});
