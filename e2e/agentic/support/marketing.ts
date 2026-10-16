// Marketing helpers: build promotions / campaigns / price changes through the
// routes the hub's own sheets call (so a test can start from a state without
// driving every form), read them back from the cloud, and see them from the
// shop's side (`/api/v1/store/quote` on store-01 answers every published
// promotion, applied or not, even for an empty basket).
import { expect } from 'e2e';
import { as, rows, tag, uid, waitFor } from './rig.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export { tag };

export const cloud = () => as('cloud', 'rina');
export const shop = () => as('store', 'maya');

/** The one article marketing tests price and discount (accessories; nobody else sells it). */
export const TAS = { article: '00000010', sku: '00000010200', name: 'Tas Selempang Kanvas', base: 219_000 };

export const rupiah = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

// ── reading ─────────────────────────────────────────────────────────────────

export async function rules(q = ''): Promise<Json[]> {
  return rows(await cloud().get(`/api/v1/commercial/rules?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`));
}

/** The rule by name; the list lags a publish by a moment, so it is awaited unless `wait` is off. */
export async function ruleNamed(name: string, { wait = true } = {}): Promise<Json | undefined> {
  for (let i = 0; i < (wait ? 15 : 1); i++) {
    const found = (await rules(name)).find((r) => r.name === name);
    if (found) return found;
    if (wait) await new Promise((r) => setTimeout(r, 1_500));
  }
  return undefined;
}

export async function ruleById(id: string): Promise<Json | undefined> {
  return (await rules(id)).find((r) => r.rule_id === id);
}

export async function campaigns(q = ''): Promise<Json[]> {
  return rows(await cloud().get(`/api/v1/commercial/campaigns?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`));
}

export async function campaignNamed(name: string): Promise<Json | undefined> {
  return (await campaigns(name)).find((c) => (c.name ?? c.campaign?.name) === name);
}

export const campaignOf = (row: Json): Json => row.campaign ?? row;

export async function books(): Promise<Json[]> {
  return rows(await cloud().get('/api/v1/commercial/publications'));
}

export async function bookNamed(name: string): Promise<Json | undefined> {
  return (await books()).find((b) => b.name === name);
}

export async function voucher(code: string): Promise<Json> {
  const got = await cloud().get(`/api/v1/commercial/vouchers/${encodeURIComponent(code)}`);
  return got?.voucher ?? got;
}

export async function ledger(): Promise<Json> {
  const page = await cloud().get('/api/v1/commercial/vouchers?limit=1');
  return page.ledger ?? page;
}

export async function usageOf(kind: 'RULE' | 'CAMPAIGN', key: string): Promise<Json | undefined> {
  const usage = await cloud().get('/api/v1/commercial/usage');
  return rows(usage).find((u) => u.kind === kind && u.key === key);
}

// ── writing, through the API (a precondition, not the thing under test) ─────

/** A rule document as the hub's rule form assembles one. */
export function ruleDoc(
  id: string,
  name: string,
  effect: Json,
  applicability: Json,
  o: {
    campaign?: string | null;
    customers?: 'EVERYONE' | 'MEMBERS';
    minAmount?: number;
    coupon?: string | null;
    maxUses?: number | null;
    from?: string | null;
    to?: string | null;
    status?: string;
  } = {},
): Json {
  return {
    rule_id: id,
    campaign_id: o.campaign ?? null,
    name,
    status: o.status ?? 'ACTIVE',
    scope: {
      applicability,
      excluded_sku_codes: [],
      site_ids: [],
      channels: [],
      customers: { who: o.customers ?? 'EVERYONE' },
      effect_on: null,
    },
    conditions: {
      min_quantity: 0,
      max_quantity: null,
      min_amount: { minor: o.minAmount ?? 0 },
      max_amount: null,
      effective_from: o.from ?? null,
      effective_to: o.to ?? null,
      days: { iso_weekdays: [] },
      time_window: null,
    },
    effect,
    coupon_code: o.coupon ?? null,
    max_discount: null,
    caps: { budget: null, spent: { minor: 0 }, max_uses: o.maxUses ?? null, used: 0 },
    max_uses_per_customer: null,
    priority: 0,
    stacking: 'ALONE',
    exclusive_scope: 'BASKET',
    advisory: false,
    markdown_policy: 'EXCLUDE',
    earn_basis: 'POST_DISCOUNT_NET',
    points_combination: 'HIGHEST',
    max_points: null,
  };
}

/** Draft + publish one book, taking the next free version (retries when another test took it first). */
export async function publishBook(name: string, content: Json = {}): Promise<Json> {
  let last: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    const all = await books();
    const version = Math.max(0, ...all.map((b) => b.version)) + 1;
    try {
      const draft = await cloud().post('/api/v1/commercial/publications', {
        tax_rules: [],
        offer_rules: [],
        markdowns: [],
        rules: [],
        coupons: [],
        campaigns: [],
        effective_to: null,
        effective_from: new Date().toISOString(),
        ...content,
        version,
        name,
        actor_id: 'rina',
        idempotency_key: uid(),
      });
      return await cloud().post(`/api/v1/commercial/publications/${draft.id}/publish`, { actor_id: 'rina', idempotency_key: uid() });
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 1_500));
    }
  }
  throw last;
}

/** A campaign envelope published through the API. */
export async function makeCampaign(name: string, o: Json = {}): Promise<string> {
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${tag('').toLowerCase()}`;
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 20 * 86_400_000);
  await publishBook(`Campaign: ${name}`, {
    campaigns: [
      {
        campaign_id: id,
        name,
        status: 'ACTIVE',
        valid_from: from.toISOString(),
        valid_to: to.toISOString(),
        budget_minor: null,
        max_uses: null,
        image_url: null,
        headline: null,
        terms: null,
        site_ids: [],
        ...o,
      },
    ],
  });
  return id;
}

/** A published promotion on the Tas article that only fires with `coupon` (so no other test's basket is touched). */
export async function makeCouponRule(name: string, coupon: string, effect: Json, o: Json = {}): Promise<string> {
  const id = `rule-${tag('').toLowerCase()}`;
  await publishBook(`Promotion: ${name}`, {
    rules: [ruleDoc(id, name, effect, { on: 'ARTICLE', article_codes: [TAS.article] }, { coupon, ...o })],
    coupons: [{ code: coupon, rule_id: id, active: true, valid_from: null, valid_to: null, max_uses: null }],
    campaigns: o.campaignDoc ? [o.campaignDoc] : [],
  });
  return id;
}

// ── the shop's side ─────────────────────────────────────────────────────────

/** A unit of `sku` standing on store-01's floor right now (the last one the ledger shows). */
export async function floorEpc(sku: string): Promise<string> {
  const moves = rows(await shop().get('/api/v1/inventory/movements?limit=5000')).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const at: Record<string, string> = {};
  for (const m of moves) at[m.epc] = m.to;
  const epc = Object.entries(at)
    .filter(([e, place]) => place === 'store-01.floor:on_hand' && e.slice(2, 13) === sku)
    .map(([e]) => e)
    .sort()
    .pop();
  if (!epc) throw new Error(`no unit of ${sku} on store-01's floor`);
  return epc;
}

/** Up to `n` distinct units of `sku` on the floor (a basket of two is how a minimum is reached). */
export async function floorEpcs(sku: string, n: number): Promise<string[]> {
  const moves = rows(await shop().get('/api/v1/inventory/movements?limit=5000')).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const at: Record<string, string> = {};
  for (const m of moves) at[m.epc] = m.to;
  const all = Object.entries(at)
    .filter(([e, place]) => place === 'store-01.floor:on_hand' && e.slice(2, 13) === sku)
    .map(([e]) => e)
    .sort();
  if (all.length < n) throw new Error(`only ${all.length} unit(s) of ${sku} on store-01's floor`);
  return all.slice(-n);
}

export async function quote(epcs: string[], { coupons = [] as string[], member = null as string | null } = {}): Promise<Json> {
  return shop().post('/api/v1/store/quote', { epcs, coupon_codes: coupons, customer_id: member, charges: [] });
}

/** The shop's answer for one promotion: its entry in an empty-basket quote, once the shop has heard of it. */
export async function shopSees(ruleId: string, ok: (entry: Json) => boolean = () => true, what = ruleId): Promise<Json> {
  return waitFor(`store-01 to report ${what}`, async () => {
    const q = await quote([]);
    const entry = (q.promotions ?? []).find((p: Json) => p.rule_id === ruleId);
    return entry && ok(entry) ? entry : null;
  }, 90_000, 2_000);
}

/** The shop has dropped (or never had) a promotion. */
export async function shopLost(ruleId: string): Promise<void> {
  await waitFor(`store-01 to drop ${ruleId}`, async () => {
    const q = await quote([]);
    return !(q.promotions ?? []).some((p: Json) => p.rule_id === ruleId);
  }, 90_000, 2_000);
}

export const iso = (daysFromToday: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
};

/** Every text is somewhere inside the locator (one expectation each; the array form wants one node per text). */
export async function has(locator: any, ...texts: string[]) {
  for (const text of texts) await expect(locator).toContainText(text);
}

/** The promotion's entry in a quote of `epcs`. */
export async function promoIn(epcs: string[], ruleId: string, o: { coupons?: string[]; member?: string | null } = {}): Promise<Json> {
  const q = await quote(epcs, o);
  return (q.promotions ?? []).find((p: Json) => p.rule_id === ruleId);
}

export async function priceChanges(): Promise<Json[]> {
  return rows(await cloud().get('/api/v1/commercial/price-changes?include_settled=true'));
}

/** Every text is visible somewhere on the page (the hub's page has no `main` landmark to scope to). */
export async function see(screen: any, ...texts: string[]) {
  for (const text of texts) await expect(screen.getByText(text, { exact: false }).first()).toBeVisible();
}

/**
 * The receipt dialog ("Paused — sent to 1 store") holds the page inert, closes itself after 3 s
 * and stays open for as long as the pointer rests on it — which it does, right after the tap that
 * raised it. Read it, then close it with Escape.
 */
export async function receipt(screen: any, browser: any, title: RegExp | string) {
  const dialog = screen.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await browser.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

/**
 * Close an open combobox list (articles, SKUs, divisions, tags, members) by tapping the sheet's header.
 * Escape is not safe: with the list open it can close the whole sheet; a tap outside the list only
 * closes the list.
 */
export async function closeList(screen: any) {
  await screen.tapAt({ x: 1000, y: 40 });
}

/** A campaign row as the book's input wants it back (every field; `null` stores become `[]`). */
export function restate(row: Json): Json {
  const c = campaignOf(row);
  return {
    campaign_id: c.campaign_id, name: c.name, status: c.status, valid_from: c.valid_from, valid_to: c.valid_to,
    budget_minor: c.budget_minor, max_uses: c.max_uses, image_url: c.image_url, headline: c.headline, terms: c.terms, site_ids: c.site_ids ?? [],
  };
}

/**
 * Press Publish and wait for the sheet to close. Other suites publish books too (every new article
 * gets a "Harga awal" book), so the version the sheet was opened with can be taken by the time the
 * button is pressed — the server says "number it v407 or later", the sheet refreshes its number and
 * a second press succeeds. That second press is what a person does; so does this.
 */
export async function publishSheet(screen: any) {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const button = screen.getByRole('button', 'Publish');
    if (!(await button.isVisible())) return;
    await button.tap();
    try {
      await expect(screen.getByRole('button', 'Publish')).toBeHidden({ timeout: attempt === 3 ? 90_000 : 20_000 });
      return;
    } catch (error) {
      last = error;
    }
  }
  throw last;
}
