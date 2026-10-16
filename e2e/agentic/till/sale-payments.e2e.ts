// Payment branches of the counter. The tile you pick decides what the node is asked for:
// cash gives change; a card/QRIS tender names its bank and needs an approval code; a voucher is held
// at head office first; a part payment leaves a remainder for a second tender.
// Every test that sells puts its unit back with a supervisor void (pos.restoreSale).
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as pos from '../support/pos.ts';
import { as, tag, waitFor } from '../support/rig.ts';

const tenderRow = (r: any, method: string) => (r.tenders as any[]).find((x) => x.method === method);

test('TILL-30 debit BCA: bank, EDC code, no change; the node books a CARD tender with the bank in its reference', { tags: ['pos'] }, async ({ app, screen, browser }) => {
  const t = { app, screen, browser };
  const unit = await pos.pickUnit('plain');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    const due = pos.dueOf(await pos.quote([unit.epc]));
    await pos.payTotal(t, due);
    await pos.goToPayment(t);
    await screen.getByRole('button', 'Debit').tap();
    await expect(screen.getByText('Bank / mesin EDC', { exact: true })).toBeVisible();
    await screen.getByRole('radio', 'BCA').tap();
    await screen.getByLabel('Kode approval EDC').fill('771234');
    // The button names the EDC the cashier is about to swipe on.
    await expect(screen.getByRole('button', /^Bayar Rp .* · Debit BCA$/)).toBeVisible();
    await screen.getByRole('button', /^Bayar Rp/).tap();
    await expect(screen.getByText('Lunas', { exact: true })).toBeVisible();
    await expect(screen.getByText('Tanpa kembalian', { exact: true })).toBeVisible();
    saleId = await pos.finishSale(t);
    const r = await pos.receipt(saleId);
    expect(r.total_minor).toBe(due);
    expect(tenderRow(r, 'CARD')?.amount_minor).toBe(due);
    expect(tenderRow(r, 'CARD')?.reference).toContain('BCA');
    expect(tenderRow(r, 'CARD')?.reference).toContain('771234');
    expect(await pos.placeOf(unit.epc)).toBe('external/customer');
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});

test('TILL-31 card refusals before the node is asked: no bank, short code, a card number, more than is owed', { tags: ['pos'] }, async ({ app, screen, browser }) => {
  const t = { app, screen, browser };
  const unit = await pos.pickUnit('plain');
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    await pos.payTotal(t);
    await pos.goToPayment(t);
    const pay = () => screen.getByRole('button', /^Bayar Rp/).tap();
    await screen.getByRole('button', 'Debit').tap();
    await screen.getByLabel('Kode approval EDC').fill('771234');
    await pay();
    await expect(screen.getByText('Pilih banknya.', { exact: true })).toBeVisible();
    await screen.getByRole('radio', 'Mandiri').tap();
    await screen.getByLabel('Kode approval EDC').fill('12');
    await pay();
    await expect(screen.getByText('Masukkan kode approval, minimal 4 karakter.', { exact: true })).toBeVisible();
    await screen.getByLabel('Kode approval EDC').fill('4111 1111 1111 1111');
    await pay();
    await expect(screen.getByText('Itu seperti nomor kartu. Tulis kode approval-nya saja.', { exact: true })).toBeVisible();
    await screen.getByLabel('Kode approval EDC').fill('884213');
    await screen.getByLabel('Nominal pembayaran').fill('9999999');
    await pay();
    await expect(screen.getByText(/^Hanya tunai yang boleh melebihi sisa/)).toBeVisible();
    // Nothing was taken: the Diterima list never appeared.
    await expect(screen.getByText('Diterima', { exact: true })).toBeHidden();
  } finally {
    pos.release(unit.epc);
  }
});

test('TILL-32 QRIS asks for its own reference and a bank', { tags: ['pos'] }, async ({ app, screen, browser }) => {
  const t = { app, screen, browser };
  const unit = await pos.pickUnit('plain');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    const due = pos.dueOf(await pos.quote([unit.epc]));
    await pos.payTotal(t, due);
    await pos.goToPayment(t);
    await screen.getByRole('button', 'QRIS').tap();
    await screen.getByRole('radio', 'BNI').tap();
    await screen.getByLabel('Nomor referensi QRIS').fill('QR20261009001');
    await screen.getByRole('button', /^Bayar Rp/).tap();
    await expect(screen.getByText('Lunas', { exact: true })).toBeVisible();
    saleId = await pos.finishSale(t);
    const r = await pos.receipt(saleId);
    expect(tenderRow(r, 'QRIS')?.amount_minor).toBe(due);
    expect(tenderRow(r, 'QRIS')?.reference).toContain('QR20261009001');
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});

test('TILL-33 credit card is its own tile with its own banks', { tags: ['pos'] }, async ({ app, screen, browser }) => {
  const t = { app, screen, browser };
  const unit = await pos.pickUnit('plain');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    const due = pos.dueOf(await pos.quote([unit.epc]));
    await pos.payTotal(t, due);
    await pos.goToPayment(t);
    await screen.getByRole('button', 'Kredit').tap();
    await screen.getByRole('radio', 'BRI').tap();
    await screen.getByLabel('Kode approval EDC').fill('990011');
    await screen.getByRole('button', /^Bayar Rp/).tap();
    await expect(screen.getByText('Lunas', { exact: true })).toBeVisible();
    saleId = await pos.finishSale(t);
    const r = await pos.receipt(saleId);
    expect(tenderRow(r, 'CARD')?.amount_minor).toBe(due);
    expect(tenderRow(r, 'CARD')?.reference).toContain('BRI');
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});

test('TILL-34 part payment: Rp 50.000 in cash first (Bayar sebagian), the rest on a debit card', { tags: ['pos'] }, async ({ app, screen, browser }) => {
  const t = { app, screen, browser };
  const unit = await pos.pickUnit('plain');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    const due = pos.dueOf(await pos.quote([unit.epc]));
    await pos.payTotal(t, due);
    await pos.goToPayment(t);
    await screen.getByLabel('Nominal pembayaran').fill('50000');
    await expect(screen.getByRole('button', /^Bayar sebagian Rp/)).toBeVisible();
    await screen.getByRole('button', /^Bayar sebagian Rp/).tap();
    // The first tender is listed and the drawer owes the rest.
    await expect(screen.getByText('Diterima', { exact: true })).toBeVisible();
    await expect(screen.getByText('Sisa', { exact: true })).toBeVisible();
    await screen.getByRole('button', 'Debit').tap();
    await screen.getByRole('radio', 'BCA').tap();
    await screen.getByLabel('Kode approval EDC').fill('552211');
    await expect(screen.getByRole('button', new RegExp(`^Bayar ${pos.rp(due - 50_000).replace(/ /g, '\\s').replace('Rp ', 'Rp\\s')}`))).toBeVisible();
    await screen.getByRole('button', /^Bayar Rp/).tap();
    await expect(screen.getByText('Lunas', { exact: true })).toBeVisible();
    saleId = await pos.finishSale(t);
    const r = await pos.receipt(saleId);
    expect(tenderRow(r, 'CASH')?.amount_minor).toBe(50_000);
    expect(tenderRow(r, 'CARD')?.amount_minor).toBe(due - 50_000);
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});

// BUG: the till sends the cash tender at the amount applied (Payment.complete → tenders[].amount_minor
// = amountMinor), not the amount handed over, so the node's receipt says paid = total, change = 0
// although the till showed and asked the cashier to give back the change.
test('TILL-35 cash presets and the change breakdown ("Kembalikan")', { tags: ['pos', 'bug'] }, async ({ app, screen, browser }) => {
  const t = { app, screen, browser };
  const unit = await pos.pickUnit('plain');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    const due = pos.dueOf(await pos.quote([unit.epc]));
    await pos.payTotal(t, due);
    await pos.goToPayment(t);
    const nextHundred = Math.ceil(due / 100_000) * 100_000;
    // A preset button is the amount due, or the next round note; the 500.000 one is always there.
    await expect(screen.getByRole('button', new RegExp(`^${pos.rp(500_000).replace('Rp ', 'Rp\\s')}$`))).toBeVisible();
    const preset = screen.getByRole('button', new RegExp(`^${pos.rp(nextHundred).replace('Rp ', 'Rp\\s')}$`));
    await preset.tap();
    await expect(screen.getByLabel('Nominal pembayaran')).toHaveValue(nextHundred.toLocaleString('id-ID'));
    await screen.getByRole('button', /^Bayar Rp/).tap();
    await expect(screen.getByText('Lunas', { exact: true })).toBeVisible();
    // The change, and the notes to count out for it.
    const change = nextHundred - due;
    await expect(screen.getByText(pos.rp(change)).first()).toBeVisible();
    await expect(screen.getByText('Kembalikan', { exact: true })).toBeVisible();
    saleId = await pos.finishSale(t);
    const r = await pos.receipt(saleId);
    expect(r.change_minor).toBe(change);
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});

test('TILL-36 voucher: held at head office, part of the bill, cash for the rest', { tags: ['pos'] }, async ({ app, screen, browser }) => {
  const t = { app, screen, browser };
  const unit = await pos.pickUnit('plain');
  const code = `E2E${tag('V')}`;
  let saleId: string | undefined;
  try {
    await as('cloud', 'rina').post('/api/v1/commercial/vouchers', {
      code,
      kind: 'GIFT_CARD',
      value_minor: 50_000,
      site_id: 'store-01',
      expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      note: 'e2e till voucher',
    });
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    const due = pos.dueOf(await pos.quote([unit.epc]));
    await pos.payTotal(t, due);
    await pos.goToPayment(t);
    await screen.getByRole('button', 'Voucher').tap();
    await screen.getByLabel('Kode voucher').fill(code);
    await screen.getByLabel('Nominal pembayaran').fill('50000');
    await screen.getByRole('button', /^Bayar sebagian Rp/).tap();
    await expect(screen.getByText('Diterima', { exact: true })).toBeVisible({ timeout: 20_000 });
    await screen.getByRole('button', 'Tunai').tap();
    await screen.getByRole('button', /^Bayar Rp/).tap();
    await expect(screen.getByText('Lunas', { exact: true })).toBeVisible();
    saleId = await pos.finishSale(t);
    const r = await pos.receipt(saleId);
    expect(tenderRow(r, 'VOUCHER')?.amount_minor).toBe(50_000);
    expect(tenderRow(r, 'CASH')?.amount_minor).toBe(due - 50_000);
    // Head office turns the hold into a redemption when the sale syncs.
    const rina = as('cloud', 'rina');
    const spent = await waitFor(`voucher ${code} redeemed`, async () => {
      const v = await rina.get(`/api/v1/commercial/vouchers/${code}`);
      const left = v.voucher?.balance_minor ?? v.balance_minor;
      return left !== undefined && left < 50_000 ? v : null;
    }, 90_000);
    expect(spent).toBeTruthy();
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});

test('TILL-37 a voucher code head office does not know is refused and nothing is taken', { tags: ['pos'] }, async ({ app, screen, browser }) => {
  const t = { app, screen, browser };
  const unit = await pos.pickUnit('plain');
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    await pos.payTotal(t);
    await pos.goToPayment(t);
    await screen.getByRole('button', 'Voucher').tap();
    await screen.getByLabel('Kode voucher').fill('TIDAKADA999');
    await screen.getByRole('button', /^Bayar Rp/).tap();
    await expect(screen.getByRole('button', /^Bayar Rp/)).toBeEnabled({ timeout: 20_000 });
    await expect(screen.getByText('Diterima', { exact: true })).toBeHidden();
    await expect(screen.getByText(/not found/)).toBeVisible();
  } finally {
    pos.release(unit.epc);
  }
});

test('TILL-38 employee balance asks for a 6-digit code before it asks the node', { tags: ['pos'] }, async ({ app, screen, browser }) => {
  const t = { app, screen, browser };
  const unit = await pos.pickUnit('plain');
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    await pos.payTotal(t);
    await pos.goToPayment(t);
    await screen.getByRole('button', 'Saldo karyawan').tap();
    await screen.getByLabel('Kode saldo karyawan').fill('12');
    await screen.getByRole('button', 'Cek saldo').tap();
    await expect(screen.getByText('Kode saldo karyawan terdiri dari 6 angka.', { exact: true })).toBeVisible();
  } finally {
    pos.release(unit.epc);
  }
});
