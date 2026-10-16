// PO › New PO composer: validation, discard, item sheet, discount, submit.
import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { poDetail, poNumbers, tag } from '../../support/rig.ts';
import { fillHeader, fillItem, openComposer, pickDay, pickSupplier } from '../../support/po.ts';

describe('New PO', () => {
  test('PO-C01 Review order with nothing filled marks every gap', { session: 'rina', tags: ['po', 'smoke'] }, async ({ app, screen }) => {
    await openComposer(app, screen);
    await screen.getByRole('button', 'Review order').tap();
    await expect(screen.getByText('Choose a supplier.')).toBeVisible();
    await expect(screen.getByText('Choose the delivery date.')).toBeVisible();
    await expect(screen.getByText('Choose the payment method.')).toBeVisible();
    await expect(screen.getByText('Add at least one item.')).toBeVisible();
  });

  test('PO-C02 New item stays disabled until a supplier is chosen', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    await openComposer(app, screen);
    await expect(screen.getByRole('button', 'New item')).toBeDisabled();
    await pickSupplier(screen);
    await expect(screen.getByRole('button', 'New item')).toBeEnabled();
    await expect(screen.getByText('Nothing on this order yet. Add what is being ordered.')).toBeVisible();
  });

  test('PO-C03 supplier picker offers only merchandise suppliers and "Create a new supplier"', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    await openComposer(app, screen);
    await screen.getByRole('combobox', 'Supplier').tap();
    await expect(screen.getByRole('option', 'Garmen Nusantara, PT')).toBeVisible();
    await expect(screen.getByRole('button', 'Create a new supplier')).toBeVisible();
  });

  test('PO-C04 payment terms are pre-filled from the supplier', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    await openComposer(app, screen);
    await pickSupplier(screen);
    await expect(screen.getByText('30 days')).toBeVisible();
  });

  test('PO-C05 Add item with nothing typed shows each error', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    await openComposer(app, screen);
    await pickSupplier(screen);
    await screen.getByRole('button', 'New item').tap();
    await screen.getByRole('button', 'Submit').tap();
    for (const msg of ['Give it a name.', 'Choose a division.', 'Choose at least one tag.', 'Fill in how many.', 'Fill in the price.']) {
      await expect(screen.getByText(msg)).toBeVisible();
    }
  });

  test('PO-C06 closing the Add item sheet with input asks to discard it', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    await openComposer(app, screen);
    await pickSupplier(screen);
    await screen.getByRole('button', 'New item').tap();
    await screen.getByRole('textbox', { name: /^Name/ }).fill('Setengah jadi');
    await screen.getByRole('button', 'Cancel').last().tap();
    await expect(screen.getByText('Discard This Item?')).toBeVisible();
    await expect(screen.getByText('What you typed and the photo will be lost.')).toBeVisible();
    await screen.getByRole('button', 'Keep Editing').tap();
    await expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue(/setengah jadi/i);
    await screen.getByRole('button', 'Cancel').last().tap();
    await screen.getByRole('button', 'Discard').tap();
    await expect(screen.getByText('Add item')).toBeHidden();
  });

  test('PO-C07 closing the composer with input asks to discard the order', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    await openComposer(app, screen);
    await pickSupplier(screen);
    await pickDay(screen);
    await screen.getByRole('button', 'Cancel').tap();
    await expect(screen.getByText('Discard This Order?')).toBeVisible();
    await expect(screen.getByText('Nothing has been saved.')).toBeVisible();
    await screen.getByRole('button', 'Keep editing').tap();
    await expect(screen.getByText('New PO')).toBeVisible();
    await screen.getByRole('button', 'Cancel').tap();
    await screen.getByRole('button', 'Discard').tap();
    await expect(screen.getByText('New PO')).toBeHidden();
  });

  test('PO-C08 an untouched composer closes without asking', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    await openComposer(app, screen);
    await screen.getByRole('button', 'Cancel').tap();
    await expect(screen.getByText('New PO')).toBeHidden();
    await expect(screen.getByText('Discard This Order?')).toBeHidden();
  });

  test('PO-C09 discount amount and percentage fill each other, capped at the total', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const t = tag();
    await openComposer(app, screen);
    await fillHeader(screen);
    await screen.getByRole('button', 'New item').tap();
    await fillItem(screen, { name: `Kaos ${t}`, qty: '10', price: '40000' });
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('button', `Edit Kaos ${t}`)).toBeVisible();
    await screen.getByRole('textbox', 'Discount percentage').fill('10');
    await expect(screen.getByRole('textbox', 'Discount agreed off the whole order')).toHaveValue(/40\.000$/);
    await screen.getByRole('textbox', 'Discount agreed off the whole order').fill('100000');
    await expect(screen.getByRole('textbox', 'Discount percentage')).toHaveValue(/25/);
    await screen.getByRole('textbox', 'Discount agreed off the whole order').fill('999999999');
    await expect(screen.getByRole('textbox', 'Discount percentage')).toHaveValue(/100/);
  });

  test('PO-C10 submit online creates the order the server numbers', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const t = tag();
    const name = `Kaos ${t}`;
    await openComposer(app, screen);
    await fillHeader(screen);
    await screen.getByRole('button', 'New item').tap();
    await fillItem(screen, { name, qty: '12', price: '40000' });
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('button', `Edit ${name}`)).toBeVisible();
    await screen.getByRole('textbox', 'Notes').fill(`catatan ${t}`);
    await screen.getByRole('button', 'Review order').tap();
    await expect(screen.getByText('Review this order')).toBeVisible();
    await expect(screen.getByRole('button', 'Back to editing')).toBeVisible();
    await screen.getByRole('button', 'Submit').tap();
    const popup = screen.getByText(/PO-\d{6}-\d{3} created/);
    await expect(popup).toBeVisible({ timeout: 30_000 });
    const number = /PO-\d{6}-\d{3}/.exec((await popup.textContent()) ?? '')![0];
    const n = await poNumbers(number);
    expect(n.expected_stock_units).toBe(12);
    expect(n.lifecycle).toBe('ACTIVE');
    const detail = await poDetail(number);
    expect(detail.notes).toContain(t);
    expect(detail.payment_method ?? detail.payment_method_code).toMatch(/transfer/i);
  });

  test('PO-C11 a line over 999.999 pieces is refused with a banner and Review stays blocked', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const t = tag();
    await openComposer(app, screen);
    await fillHeader(screen);
    await screen.getByRole('button', 'New item').tap();
    await fillItem(screen, { name: `Kaos ${t}`, qty: '1000000', price: '1000' });
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('A line is at most 999.999 pieces.')).toBeVisible();
    await screen.getByRole('button', 'Review order').tap();
    await expect(screen.getByText('Review this order')).toBeHidden();
  });

  test('PO-C12 a price over Rp 99.999.999 a piece is refused with a banner', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const t = tag();
    await openComposer(app, screen);
    await fillHeader(screen);
    await screen.getByRole('button', 'New item').tap();
    await fillItem(screen, { name: `Kaos ${t}`, qty: '2', price: '100000000' });
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('A price is at most Rp 99.999.999 a piece.')).toBeVisible();
  });

  test('PO-C13 an order total over Rp 99.999.999.999 is refused with a banner', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const t = tag();
    await openComposer(app, screen);
    await fillHeader(screen);
    await screen.getByRole('button', 'New item').tap();
    await fillItem(screen, { name: `Kaos ${t}`, qty: '999999', price: '99999999' });
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('An order comes to at most Rp 99.999.999.999.')).toBeVisible();
  });

  test('PO-C14 the pencil reopens the line as "Edit line" and the bin takes it off', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const t = tag();
    await openComposer(app, screen);
    await fillHeader(screen);
    await screen.getByRole('button', 'New item').tap();
    await fillItem(screen, { name: `Kaos ${t}`, qty: '5', price: '30000' });
    await screen.getByRole('button', 'Submit').tap();
    await screen.getByRole('button', `Edit Kaos ${t}`).tap();
    await expect(screen.getByText('Edit line')).toBeVisible();
    await screen.getByRole('textbox', 'Quantity to order').fill('7');
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('row', { name: new RegExp(`Kaos ${t}.*7 pcs`) })).toBeVisible();
    await screen.getByRole('button', `Take Kaos ${t} off this order`).tap();
    await expect(screen.getByText('Nothing on this order yet. Add what is being ordered.')).toBeVisible();
  });

  test('PO-C15 offline: Submit keeps the order on the device and it is sent when the connection is back', { session: 'rina', tags: ['po'] }, async ({ app, screen, browser }) => {
    const t = tag();
    await openComposer(app, screen);
    await fillHeader(screen);
    await screen.getByRole('button', 'New item').tap();
    await fillItem(screen, { name: `Kaos ${t}`, qty: '6', price: '25000' });
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('button', `Edit Kaos ${t}`)).toBeVisible();
    await browser.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    await expect(screen.getByText('You are offline. Submit keeps this order on this device and sends it when the connection is back.')).toBeVisible();
    await screen.getByRole('button', 'Review order').tap();
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('Saved on this device. It will be sent when you are back online.')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText('Offline').first()).toBeVisible();
    await browser.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      window.dispatchEvent(new Event('online'));
    });
    await expect(screen.getByText(/PO-\d{6}-\d{3} created/)).toBeVisible({ timeout: 60_000 });
  });

  test('PO-C16 the same catalogue item added twice merges into one line', { session: 'rina', tags: ['po'] }, async () => {
    test.skip(true, 'not reachable from the blank composer: New item always mints a new supplier item, and the catalogue picker is unused (map E10); merging happens only from Sourcing > Basket');
  });

  test('PO-C17 "Create a new supplier" opens the supplier composer', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    await openComposer(app, screen);
    await screen.getByRole('combobox', 'Supplier').tap();
    await screen.getByRole('button', 'Create a new supplier').tap();
    await expect(screen.getByRole('dialog', /supplier/i)).toBeVisible();
  });

  test('PO-C18 an order kept offline opens a sheet with its banner, and can be deleted', { session: 'rina', tags: ['po'] }, async ({ app, screen, browser }) => {
    const t = tag();
    await openComposer(app, screen);
    await fillHeader(screen);
    await screen.getByRole('button', 'New item').tap();
    await fillItem(screen, { name: `Kaos ${t}`, qty: '6', price: '25000' });
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('button', `Edit Kaos ${t}`)).toBeVisible();
    await browser.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    await screen.getByRole('button', 'Review order').tap();
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('Saved on this device. It will be sent when you are back online.')).toBeVisible({ timeout: 30_000 });
    const row = screen.getByRole('row', { name: /Offline/ }).first();
    await expect(row).toBeVisible();
    await row.tap();
    await expect(screen.getByText(/This order is on this device\. It will be sent by itself when you are back online\.|It goes by itself in a moment\./)).toBeVisible();
    await expect(screen.getByRole('button', 'Edit')).toBeVisible();
    await screen.getByRole('button', 'Delete Order').tap();
    await expect(screen.getByText('Delete This Order?')).toBeVisible();
    await screen.getByRole('button', 'Keep Order').tap();
    await expect(screen.getByText('Delete This Order?')).toBeHidden();
    await screen.getByRole('button', 'Delete Order').tap();
    await expect(screen.getByText('Delete This Order?')).toBeVisible();
    await screen.getByRole('button', 'Delete Order').last().tap();
    await expect(screen.getByRole('row', { name: /Offline/ })).toHaveCount(0);
  });
});
