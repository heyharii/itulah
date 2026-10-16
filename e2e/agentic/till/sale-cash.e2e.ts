import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as pos from '../support/pos.ts';

test('TILL-20 cash sale: the screen total equals the node quote, the sale is in the node\'s sales, the unit leaves the floor — and a void puts it back', { tags: ['pos', 'smoke'] }, async ({ app, screen, browser }) => {
  const t = { app, screen, browser };
  const unit = await pos.pickUnit('plain');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    const due = pos.dueOf(await pos.quote([unit.epc]));
    expect(await pos.payTotal(t, due)).toBe(due);
    await pos.goToPayment(t);
    await screen.getByLabel('Nominal pembayaran').fill(String(due + 11_000));
    await screen.getByRole('button', /^Bayar Rp/).tap();
    await expect(screen.getByText('Lunas', { exact: true })).toBeVisible();
    await expect(screen.getByText(pos.rp(11_000)).first()).toBeVisible();
    saleId = await pos.finishSale(t);
    expect((await pos.saleInWindow(saleId))?.total_minor).toBe(due);
    expect((await pos.receipt(saleId)).total_minor).toBe(due);
    expect(await pos.placeOf(unit.epc)).toBe('external/customer');
    await pos.nextSale(t);
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
  await pos.waitOnFloor(unit.epc);
});
