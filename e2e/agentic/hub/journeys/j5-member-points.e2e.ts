// J5 — Member points round trip. A shopper is enrolled → dian rings up a sale for her card at the web
// till (the till shows the points it will earn) → head office credits the points and Marketing › Members
// shows them → dian types 10 points in the till's Bayar (Poin row) and asks, the shopper taps Approve in
// the member app → the balance drops in the hub, the points ledger and the voucher book agree.
//
// The garment is one of our own on store-01's floor (ownFloorUnits), priced Rp 250.000 so the sale earns
// 25 points ("1 poin per Rp 10.000", rule-poin-member). Cash only, never a bag charge.
import { beforeAll, describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as J from '../../support/journeys.ts';
import * as pos from '../../support/pos.ts';
import { signedIn } from '../../support/inventory.ts';
import { voucher } from '../../support/marketing.ts';
import { as, nudge, rows, tag, waitFor } from '../../support/rig.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
const L = J.lateChecks();
const PRICE = 250_000;
const REDEEM = 10;

const account = async (card: string): Promise<Json> => ((await J.cloud().get(`/api/v1/members?q=${card}`)).members as Json[]).find((m) => m.member_id === card);
const ledger = async (card: string): Promise<Json[]> => rows(await J.cloud().get(`/api/v1/members/points-ledger?customer_id=${card}&limit=50`));

describe('J5 Member points round trip', { serial: true, tags: ['journey', 'j5', 'marketing', 'pos'] }, () => {

  test('J5-01 a shopper is enrolled (no purchases, no points) and a Rp 250.000 garment of ours stands on store-01\'s floor', { timeout: 420_000 }, async ({ app, screen, browser }) => {
    S.t = tag('JM');
    S.card = '0899' + String(Date.now()).slice(-7) + Math.floor(Math.random() * 10);
    S.name = `Tamu Poin ${S.t}`;
    await as('cloud', 'dian').post('/api/v1/members', { member_id: S.card, display_name: S.name });
    const m = await account(S.card);
    expect(m).toMatchObject({ display_name: S.name, points_balance: 0, transaction_count: 0 });
    S.sup = await J.ownSupplier('member points');
    const shelf = await J.ownFloorUnits(S.sup, { onFloor: 1, basePrice: PRICE });
    S.epc = shelf.epcs[0];
    const q = await pos.quote([S.epc], { member: S.card }, L);
    expect(pos.dueOf(q)).toBe(PRICE);
    S.points = q.points_earned as number;
    expect(S.points, '1 point per Rp 10.000').toBe(PRICE / 10_000);
    await signedIn(app, browser, 'rina');
    await L.late('Marketing › Members lists the new card as "Never bought"', async () => {
      await app.open('/members');
      await screen.getByRole('textbox').first().fill(S.name);
      const row = screen.getByRole('row').filter({ hasText: S.name });
      await expect(row).toBeVisible({ timeout: 60_000 });
      await expect(row).toContainText('Never bought');
    });
  });

  test('J5-02 dian rings the garment up for her card at the web till: "+25" points shown, cash paid, the node books the sale', { timeout: 300_000 }, async ({ app, screen, browser }) => {
    const sale = await J.tillSale(J.tillOf(app, screen, browser), [S.epc], { member: S.card }, L);
    S.saleId = sale.saleId;
    expect(sale.due).toBe(PRICE);
    expect(sale.quote.points_earned).toBe(S.points);
    expect((await pos.receipt(S.saleId)).total_minor).toBe(PRICE);
    expect(await pos.placeOf(S.epc)).toBe('external/customer');
  });

  test('J5-03 head office credits the points: the sale carries her card, the ledger has one EARN of 25 for it, her balance is 25 — and Marketing › Members says the same', { timeout: 420_000 }, async ({ app, screen, browser }) => {
    const synced = await waitFor('the sale at head office', async () => {
      await nudge('store', 'cloud');
      const list = await J.cloud().get('/api/v1/sales?limit=500');
      return (list.items ?? list.rows ?? []).find((s: Json) => s.id === S.saleId);
    }, 240_000, 4_000);
    expect(synced).toMatchObject({ customer_id: S.card, total_minor: PRICE });
    const acct = await waitFor('her points', async () => {
      await nudge('store', 'cloud');
      const a = await account(S.card);
      return a && a.points_balance > 0 ? a : null;
    }, 180_000, 4_000);
    expect(acct).toMatchObject({ points_balance: S.points, points_earned_total: S.points, points_spent_total: 0, transaction_count: 1, spent_minor: PRICE });
    const earned = (await ledger(S.card)).filter((e) => e.entry_type === 'EARN');
    expect(earned).toHaveLength(1);
    expect(earned[0]).toMatchObject({ points: S.points, sale_id: S.saleId });
    await signedIn(app, browser, 'rina');
    await L.late('the member sheet reads Points held 25', async () => {
      await app.open(`/members?member=${S.card}`);
      const sheet = screen.getByRole('dialog');
      await expect(sheet).toContainText(S.name, { timeout: 60_000 });
      for (const t of ['Points held', 'Points earned', String(S.points)]) await expect(sheet).toContainText(t);
    });
  });

  test('J5-04 dian types 10 points in Bayar, asks, and she taps Approve in the member app: the Poin row turns into a voucher', { timeout: 300_000 }, async ({ app, screen, browser }) => {
    // The cashier says how many points (owner, 25 Oct 2026); the shopper only approves. The other way to approve, the six digits
    // head office sends to her WhatsApp, cannot be read by a test (see TILL-72c).
    const t = J.tillOf(app, screen, browser);
    const unit = await pos.pickUnit('plain');
    try {
      const shopper = await pos.memberApp(S.card);
      await pos.openBayarForMember(t, unit.epc, S.card, J.openCounter);
      await pos.askPoints(t, REDEEM);
      const ask = await waitFor('her ask in the member app', () => shopper.waiting(), 20_000, 1_000);
      expect(ask).toMatchObject({ points: REDEEM, status: 'PENDING' });
      await shopper.approve(ask.request_id);
      await expect(screen.getByText(pos.rpRe(ask.value_minor, `${REDEEM} poin ditukar · `))).toBeVisible({ timeout: 20_000 });
      // The code of the voucher it became: the same answer the till got from head office.
      const progress = await as('store', 'dian').post(`/api/v1/store/points/redeem-requests/${ask.request_id}/progress`, {});
      S.voucher = progress.voucher.voucher_code as string;
      expect(S.voucher).toMatch(/\S{4,}/);
      await screen.getByRole('button', 'Kembali ke transaksi').tap();
      await expect(pos.scanField(screen)).toBeVisible();
    } finally {
      pos.release(unit.epc);
    }
  });

  test('J5-05 the balance drops in the hub: 25 → 15, 10 spent; the points ledger has the swap, the voucher book has the voucher; Marketing › Members agrees', { timeout: 420_000 }, async ({ app, screen, browser }) => {
    const acct = await waitFor('her balance to drop', async () => {
      await nudge('store', 'cloud');
      const a = await account(S.card);
      return a && a.points_balance === S.points - REDEEM ? a : null;
    }, 180_000, 3_000);
    expect(acct).toMatchObject({ points_balance: S.points - REDEEM, points_earned_total: S.points, points_spent_total: REDEEM });
    const swap = (await ledger(S.card)).filter((e) => e.entry_type === 'REDEEM_TO_VOUCHER');
    expect(swap).toHaveLength(1);
    expect(swap[0].points).toBe(-REDEEM);
    expect(swap[0].redemption_id).toBeTruthy();
    const v = await voucher(S.voucher);
    expect(v, 'the voucher the approved ask became is in the voucher book').toBeTruthy();
    expect(JSON.stringify(v)).toContain(S.voucher);
    expect(acct.voucher_balance_minor, 'her voucher balance in the directory').toBeGreaterThan(0);
    await signedIn(app, browser, 'rina');
    await L.late('the member sheet reads Points held 15 and Points spent 10', async () => {
      await app.open(`/members?member=${S.card}`);
      const sheet = screen.getByRole('dialog');
      await expect(sheet).toContainText(S.name, { timeout: 60_000 });
      for (const t of ['Points held', 'Points spent', 'On voucher']) await expect(sheet).toContainText(t);
      await expect(sheet).toContainText(String(S.points - REDEEM));
    });
  });

  test('J5-99 [bug] the screens along the way agree with the books (misses collected along the journey)', { tags: ['bug'] }, async () => {
    expect(L.misses, 'screen checks that missed').toEqual([]);
  });
});
