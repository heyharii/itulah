// Procurement › Sourcing and the Basket (screens/procurement/sourcing.tsx, basket.tsx): every supplier's catalogue in
// one place; pieces picked into a per-person basket; "Raise an order" turns one supplier's basket into a PO.
// Each test makes its own supplier + item and signs in as `admin`, so rina's basket is never touched.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { poDetail, poNumbers } from '../../support/rig.ts';
import {
  basket, cloudCall, createItemApi, createSupplierApi, emptyBasket, openList, rupiah, SLOW, tag,
} from '../../support/merchandise.ts';
import { pickDay, pickMethod } from '../../support/po.ts';

const TAGS = ['merchandise', 'sourcing'];

/** A supplier of this test's own with one item, and the admin's basket emptied. */
async function stock(price = 55_000) {
  const t = tag('SR');
  const supplier = await createSupplierApi(`Uji Sumber ${t}`);
  const item = await createItemApi(supplier.supplier_id, `${t}-ITM`, `Kaos Sumber ${t}`, price);
  await emptyBasket('admin');
  return { t, supplier, item, name: item.name as string };
}

const pick = (itemId: string, quantity: number) =>
  cloudCall('POST', '/api/v1/sourcing-basket', { supplier_item_id: itemId, quantity }, { who: 'admin' });

describe('Sourcing and basket', { session: 'admin', tags: TAGS, timeout: 300_000 }, () => {
  test('MER-160 Sourcing finds a supplier\'s item by name', { tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const s = await stock();
    await openList(app, screen, '/procurement/sourcing', 'Sourcing');
    await screen.getByRole('combobox', 'Filter').fill(s.name);
    await screen.getByRole('combobox', 'Filter').press('Enter');
    await expect(screen.getByText(s.name, { exact: false }).first()).toBeVisible({ timeout: 90_000 });
    await expect(screen.getByText('item matches', { exact: false })).toBeVisible();
  });

  test('MER-161 the item sheet adds pieces to the basket', { tags: TAGS }, async ({ app, screen }) => {
    const s = await stock();
    await app.open(`/procurement/sourcing?item=${s.item.supplier_item_id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('button', 'Add to basket')).toBeVisible({ timeout: 90_000 });
    await expect(sheet).toContainText(s.name);
    await sheet.getByRole('spinbutton', 'Pieces').fill('12');
    await sheet.getByRole('button', 'Add to basket').tap();
    await expect.poll(async () => (await basket('admin')).length, { timeout: 30_000 }).toBe(1);
    const lines = await basket('admin');
    expect(lines[0].quantity).toBe(12);
    expect(lines[0].item.supplier_item_id).toBe(s.item.supplier_item_id);
  });

  test('MER-162 the Pieces box refuses zero: Add to basket stays disabled', { tags: TAGS }, async ({ app, screen }) => {
    const s = await stock();
    await app.open(`/procurement/sourcing?item=${s.item.supplier_item_id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('button', 'Add to basket')).toBeVisible({ timeout: 90_000 });
    await sheet.getByRole('spinbutton', 'Pieces').fill('0');
    await expect(sheet.getByRole('button', 'Add to basket')).toBeDisabled();
    expect((await basket('admin')).length).toBe(0);
  });

  test('MER-163 the basket totals its supplier, lines, pieces and catalogue value', { tags: TAGS }, async ({ app, screen }) => {
    const s = await stock();
    await pick(s.item.supplier_item_id, 12);
    await app.open('/procurement/sourcing?cart=true');
    const sheet = screen.getByRole('dialog', 'Basket');
    await expect(sheet).toContainText(s.name, { timeout: 90_000 });
    await expect(sheet).toContainText('At Catalogue Prices');
    await expect(sheet).toContainText(rupiah(12 * 55_000));
    await expect(sheet.getByRole('spinbutton', `Pieces of ${s.name}`)).toHaveValue('12');
    await expect(sheet.getByRole('button', 'Raise an order')).toBeEnabled();
  });

  test('MER-164 changing the pieces in the basket re-prices the line', { tags: TAGS }, async ({ app, screen }) => {
    const s = await stock();
    await pick(s.item.supplier_item_id, 12);
    await app.open('/procurement/sourcing?cart=true');
    const sheet = screen.getByRole('dialog', 'Basket');
    const box = sheet.getByRole('spinbutton', `Pieces of ${s.name}`);
    await expect(box).toBeVisible({ timeout: 90_000 });
    await box.fill('20');
    await box.press('Tab');
    await expect(sheet).toContainText(rupiah(20 * 55_000), SLOW);
    expect((await basket('admin'))[0].quantity).toBe(20);
  });

  test('MER-165 Raise an order opens New PO on the basket\'s supplier and places the order', { tags: TAGS }, async ({ app, screen }) => {
    const s = await stock();
    await pick(s.item.supplier_item_id, 20);
    await app.open('/procurement/sourcing?cart=true');
    const sheet = screen.getByRole('dialog', 'Basket');
    await expect(sheet).toContainText(s.name, { timeout: 90_000 });
    await sheet.getByRole('button', 'Raise an order').tap();
    const composer = screen.getByRole('dialog', 'New PO');
    await expect(composer).toContainText(s.name, SLOW);
    await pickDay(screen);
    await pickMethod(screen);
    await screen.getByRole('button', 'Review order').tap();
    await expect(screen.getByText('Review this order')).toBeVisible();
    await screen.getByRole('button', 'Submit').tap();
    const popup = screen.getByText(/PO-\d{6}-\d{3} created/);
    await expect(popup).toBeVisible({ timeout: 60_000 });
    const number = /PO-\d{6}-\d{3}/.exec((await popup.textContent()) ?? '')![0];
    const n = await poNumbers(number);
    expect(n.expected_stock_units).toBe(20);
    const detail = await poDetail(number);
    expect(JSON.stringify(detail)).toContain(s.item.supplier_item_id);
  });

  test('MER-166 the basket row\'s bin takes a line out and Empty clears everything', { tags: TAGS }, async ({ app, screen }) => {
    const a = await stock(30_000);
    const b = await createItemApi(a.supplier.supplier_id, `${a.t}-ITB`, `Kaos Kedua ${a.t}`, 30_000);
    await pick(a.item.supplier_item_id, 5);
    await pick(b.supplier_item_id, 5);
    await app.open('/procurement/sourcing?cart=true');
    const sheet = screen.getByRole('dialog', 'Basket');
    await expect(sheet).toContainText(a.name, { timeout: 90_000 });
    await sheet.getByRole('button', `Take ${a.name} out`).tap();
    await expect.poll(async () => (await basket('admin')).length, { timeout: 30_000 }).toBe(1);
    await sheet.getByRole('button', 'Empty').tap();
    await expect(sheet).toContainText('Nothing has been picked out yet.', SLOW);
    expect((await basket('admin')).length).toBe(0);
    await expect(sheet.getByRole('link', 'Go to sourcing')).toBeVisible();
  });

  test('MER-167 opening one supplier narrows Sourcing to what it sells and shows its head', { tags: TAGS }, async ({ app, screen }) => {
    const s = await stock();
    await app.open(`/procurement/sourcing?supplier=${s.supplier.supplier_id}`);
    await expect(screen.getByText(`Uji Sumber ${s.t}`, { exact: false }).first()).toBeVisible({ timeout: 90_000 });
    await expect(screen.getByText(s.supplier.supplier_code, { exact: true }).first()).toBeVisible();
    await expect(screen.getByText(s.name, { exact: false }).first()).toBeVisible();
    await expect(screen.getByText('1 items', { exact: false }).first()).toBeVisible();
  });
});
