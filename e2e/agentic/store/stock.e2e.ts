// The shop's stock: pools, moving a garment between Stockroom / Shop floor / Return stock, the ledger.
// Moves are always undone (a unit moved off the floor is moved back) so the floor keeps its stock.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { uid, as, rows } from '../support/rig.ts';
import * as pos from '../support/pos.ts';

const WH = 'store-01.warehouse:on_hand';

const moveByApi = (epc: string, from: string, to: string) =>
  as('store', 'maya').post('/api/v1/store/movements', {
    epc, quantity: 1, from, to, cause: 'NORMAL_MOVE', reason: 'e2e: put back', actor_id: 'maya', idempotency_key: uid(),
  });

/** The app's own select (Base UI): tap the combobox, then the option. */
async function choose(screen: any, label: string, option: string) {
  await screen.getByRole('combobox', label).tap();
  await screen.getByRole('option', option).tap();
}

async function poolStock() {
  const pools = rows(await as('store', 'maya').get('/api/v1/inventory/pools')).filter((p) => !p.is_rollup);
  return Object.fromEntries(pools.map((p) => [p.id, p])) as Record<string, any>;
}

test('STORE-60 Stock lists the shop\'s pools with the node\'s figures; Missing filters; a pool opens with its last movements', { session: 'maya-store', tags: ['pos', 'smoke'] }, async ({ app, screen }) => {
  const pools = await poolStock();
  const floor = pools['store-01.floor'];
  const onHand = Object.values(pools).reduce((s, p: any) => s + p.on_hand, 0);
  await app.open('/stock');
  await expect(screen.getByText('Shop floor', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText('Stockroom', { exact: true }).first()).toBeVisible();
  await expect(screen.getByText('Return stock', { exact: true }).first()).toBeVisible();
  expect(floor.on_hand).toBeGreaterThan(0);
  await expect(screen.getByText(String(onHand), { exact: true }).first()).toBeVisible();
  // Missing: nothing missing on this rig, so the filter says so.
  await screen.getByRole('button', /^Missing · /).tap();
  await expect(screen.getByText('Nothing missing.', { exact: true })).toBeVisible();
  await screen.getByRole('button', /^Everything · /).tap();
  await screen.getByText('Shop floor', { exact: true }).first().tap();
  const sheet = screen.getByRole('dialog', 'Shop floor');
  await expect(sheet.getByText('Last movements', { exact: true })).toBeVisible();
  await expect(sheet.getByText('On hand', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', 'Stock ledger')).toBeVisible();
  await expect(sheet.getByRole('button', 'Move stock')).toBeVisible();
});

test('STORE-61 Move stock: a garment goes from the shop floor to the stockroom and back; the node\'s ledger agrees', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  const unit = await pos.pickUnit('plain');
  try {
    await app.open('/stock');
    await screen.getByRole('button', 'Move stock').first().tap();
    const sheet = screen.getByRole('dialog', 'Move stock');
    await expect(sheet).toBeVisible();
    await choose(screen, 'From', 'Shop floor');
    await choose(screen, 'To', 'Stockroom');
    await expect(sheet.getByText(/^Scan a tag to load the piece/)).toBeVisible();
    await sheet.getByPlaceholder("Scan the garment's tag…").fill(unit.epc);
    await sheet.getByPlaceholder("Scan the garment's tag…").press('Enter');
    await expect(sheet.getByText('Ready to move', { exact: true })).toBeVisible();
    await expect(sheet.getByText(unit.name, { exact: false }).first()).toBeVisible();
    await screen.getByPlaceholder('e.g. Put out on the rail').fill('e2e: rak belakang');
    await sheet.getByRole('button', 'Move to stockroom').tap();
    await expect(sheet.getByText('Moved just now', { exact: false })).toBeVisible({ timeout: 20_000 });
    expect(await pos.placeOf(unit.epc)).toBe(WH);
    // …and the other way, in the same sheet.
    await choose(screen, 'From', 'Stockroom');
    await choose(screen, 'To', 'Shop floor');
    await sheet.getByPlaceholder("Scan the garment's tag…").fill(unit.epc);
    await sheet.getByPlaceholder("Scan the garment's tag…").press('Enter');
    await sheet.getByRole('button', 'Move to shop floor').tap();
    await pos.waitOnFloor(unit.epc);
  } finally {
    if ((await pos.placeOf(unit.epc)) !== pos.FLOOR) await moveByApi(unit.epc, WH, pos.FLOOR);
    pos.release(unit.epc);
  }
});

test('STORE-62 Move stock guards: a barcode is not a tag, a stray string is not a tag, same place both ends, Drop it', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  const unit = await pos.pickUnit('plain');
  try {
    await app.open('/stock');
    await screen.getByRole('button', 'Move stock').first().tap();
    const sheet = screen.getByRole('dialog', 'Move stock');
    const field = sheet.getByPlaceholder("Scan the garment's tag…");
    await field.fill(unit.sku);
    await field.press('Enter');
    await expect(sheet.getByText(/^Moving stock needs the garment's own tag/)).toBeVisible();
    await sheet.getByPlaceholder("Scan the garment's tag…").fill('bukan-tag');
    await sheet.getByPlaceholder("Scan the garment's tag…").press('Enter');
    await expect(sheet.getByText(/is not a tag this shop can read/)).toBeVisible();
    await choose(screen, 'From', 'Shop floor');
    await choose(screen, 'To', 'Shop floor');
    await sheet.getByPlaceholder("Scan the garment's tag…").fill(unit.epc);
    await sheet.getByPlaceholder("Scan the garment's tag…").press('Enter');
    await expect(sheet.getByText('A garment cannot be moved to where it already is. Pick where it is going.', { exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', /^Move to/)).toBeDisabled();
    await sheet.getByRole('button', 'Drop it').tap();
    await expect(sheet.getByText('Ready to move', { exact: true })).toBeHidden();
    expect(await pos.placeOf(unit.epc)).toBe(pos.FLOOR);
  } finally {
    pos.release(unit.epc);
  }
});

test('STORE-63 only a supervisor moves stock: dian\'s move is refused by the node and nothing moves', { session: 'dian-store', tags: ['pos'] }, async ({ app, screen }) => {
  const unit = await pos.pickUnit('plain');
  try {
    await app.open('/stock');
    await screen.getByRole('button', 'Move stock').first().tap();
    const sheet = screen.getByRole('dialog', 'Move stock');
    await choose(screen, 'From', 'Shop floor');
    await choose(screen, 'To', 'Stockroom');
    await sheet.getByPlaceholder("Scan the garment's tag…").fill(unit.epc);
    await sheet.getByPlaceholder("Scan the garment's tag…").press('Enter');
    await sheet.getByRole('button', 'Move to stockroom').tap();
    await expect(sheet.getByText(/forbidden|may not|supervisor|not allowed|permission/i).first()).toBeVisible({ timeout: 20_000 });
    expect(await pos.placeOf(unit.epc)).toBe(pos.FLOOR);
  } finally {
    pos.release(unit.epc);
  }
});

test('STORE-64 Stock ledger: today\'s sale shows as a movement out; filters and the search narrow it', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  const unit = await pos.pickUnit('plain');
  let saleId: string | undefined;
  try {
    saleId = (await pos.sellByApi([unit.epc])).sale_id;
    await app.open('/stock/movements');
    await expect(screen.getByText('Newest 100 movements', { exact: false })).toBeVisible({ timeout: 20_000 });
    await screen.getByLabel('Search the ledger').fill(unit.epc);
    await expect(screen.getByText('Sale', { exact: true }).first()).toBeVisible();
    await expect(screen.getByText(unit.name, { exact: false }).first()).toBeVisible();
    await screen.getByRole('button', /^In · /).tap();
    await expect(screen.getByText('Sale', { exact: true })).toBeHidden();
    await screen.getByRole('button', /^Out · /).tap();
    await expect(screen.getByText('Sale', { exact: true }).first()).toBeVisible();
    await screen.getByLabel('Search the ledger').fill('zzzz-tidak-ada');
    await expect(screen.getByText('No match for “zzzz-tidak-ada”.', { exact: true })).toBeVisible();
    await expect(screen.getByRole('button', 'Show the last 500')).toBeVisible();
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});
