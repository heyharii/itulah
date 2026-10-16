// One agent-driven checkout (Haiku), to prove the till is drivable from a plain-language goal. Everything it
// should have done is then checked with exact locators and the node, not with the model.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as pos from '../support/pos.ts';

test('TILL-90 the agent takes a basket from the counter to "Transaksi selesai" paying cash', { tags: ['pos', 'agent'] }, async ({ app, screen, browser, agent }) => {
  const t = { app, screen, browser };
  const unit = await pos.pickUnit('plain');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    const due = pos.dueOf(await pos.quote([unit.epc]));
    await pos.payTotal(t, due);
    await agent.act('open the payment screen with the Bayar button, pay the full amount in cash (Tunai), then press Selesaikan transaksi');
    await expect(screen.getByRole('dialog', 'Transaksi selesai')).toBeVisible({ timeout: 40_000 });
    saleId = await pos.saleIdOnCard(screen);
    expect((await pos.receipt(saleId)).total_minor).toBe(due);
    expect(await pos.placeOf(unit.epc)).toBe('external/customer');
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});
