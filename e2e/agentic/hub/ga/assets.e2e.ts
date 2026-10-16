// GA › Assets: the register, the asset sheet (Detail, Documents, History,
// Class accounts), registering one, moving it, and proposing a replacement or
// a disposal. Every asset is made here with this run's tag in its code.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { viewports } from '../../support/base.ts';
import { admin, choose, chooseNth, GA_SITE, registerAsset, SLOW, tag, L } from '../../support/stores-ga.ts';

const assetOf = async (id: string) => admin().get(`/api/v1/ga/assets/${id}`);

describe('GA: assets register', { tags: ['ga'] }, () => {
  test('GA-10 the register has its type chips, its three books and the nine columns', { session: 'rina', tags: ['ga', 'smoke'] }, async ({ app, screen }) => {
    await registerAsset(tag('A'));
    await app.open('/assets');
    await expect(screen.getByRole('heading', 'Assets')).toBeVisible({ timeout: SLOW });
    for (const book of ['All', 'Needs details', 'Registered']) await expect(screen.getByRole('button', book)).toBeVisible();
    for (const head of ['Code', 'Asset', 'Class', 'Location', 'Area', 'Holder', 'Condition', 'GA status', 'Finance status']) {
      await expect(screen.getByText(head, { exact: true }).first()).toBeVisible({ timeout: SLOW });
    }
    await expect(screen.getByText(/\d+ assets?/).first()).toBeVisible();
  });

  test('GA-11 an asset registered through the API is a row with its code, name, place and condition', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('B');
    await registerAsset(t);
    await app.open('/assets');
    await screen.getByRole('textbox').first().fill(`AST-${t}`);
    const row = screen.getByText(`Rak Uji ${t}`);
    await expect(row).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(`AST-${t}`).first()).toBeVisible();
    await expect(screen.getByText('Good').first()).toBeVisible();
  });

  test('GA-12 the sheet opens on Detail with the facts and offers Documents, History and Class accounts', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('C');
    const a = await registerAsset(t, { sub_location: 'Gudang belakang', holder: 'Pak Uji' });
    await app.open(`/assets?asset=${a.asset_id}`);
    await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
    for (const tab of ['Detail', 'Documents', 'History', 'Class accounts']) await expect(screen.getByRole('tab', tab)).toBeVisible();
    for (const term of ['Type', 'Class', 'Site', 'Area', 'Holder', 'Condition', 'Serial / plate', 'Acquired']) await expect(screen.getByText(term, { exact: true }).first()).toBeVisible();
    await expect(screen.getByText('Gudang belakang').first()).toBeVisible();
    await expect(screen.getByText('Pak Uji').first()).toBeVisible();
    await expect(screen.getByRole('button', 'Move')).toBeVisible();
  });

  test('GA-13 Register stays disabled until name, code, class, site and date are given', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    await app.open('/assets');
    await screen.getByRole('button', 'Register asset', { visible: true }).tap();
    await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
    const register = screen.getByRole('button', 'Register');
    await expect(register).toBeDisabled();
    await screen.getByLabel(L('Item name')).fill('Rak percobaan');
    await screen.getByLabel(L('Asset code')).fill('AST-XYZ');
    await expect(register).toBeDisabled();
    await choose(screen, 'Site', /Cirebon/);
    await screen.getByLabel(L('Date acquired')).fill('2026-10-01');
    await expect(register).toBeDisabled(); // class still missing
    await screen.getByRole('button', 'Cancel').tap();
    await expect(screen.getByRole('dialog')).toBeHidden();
  });

  test('GA-14 registering through the form creates the asset and opens its sheet', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('D');
    await app.open('/assets');
    await screen.getByRole('button', 'Register asset', { visible: true }).tap();
    await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
    await screen.getByLabel(L('Item name')).fill(`Meja Uji ${t}`);
    await screen.getByLabel(L('Asset code')).fill(`AST-${t}`);
    await screen.getByRole('radio', { name: /^Operating equipment/ }).tap();
    await chooseNth(screen, 'Class', 1);
    await choose(screen, 'Site', /Cirebon/);
    await screen.getByLabel(L('Date acquired')).fill('2026-10-01');
    await screen.getByRole('button', 'Register').tap();
    await expect(screen.getByRole('tab', 'Documents')).toBeVisible({ timeout: SLOW });
    const rows = (await admin().get(`/api/v1/ga/assets?q=AST-${t}`)).rows as { name: string; site_id: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe(`Meja Uji ${t}`);
    expect(rows[0].site_id).toBe(GA_SITE);
  });

  test('GA-15 a duplicate asset code is refused with a sentence, not "database operation failed" (HTTP 500)', { session: 'rina', tags: ['ga', 'bug'] }, async ({ app, screen }) => {
    const t = tag('E');
    await registerAsset(t);
    await app.open('/assets');
    await screen.getByRole('button', 'Register asset', { visible: true }).tap();
    await screen.getByLabel(L('Item name')).fill('Duplikat');
    await screen.getByLabel(L('Asset code')).fill(`AST-${t}`);
    await screen.getByRole('radio', { name: /^Operating equipment/ }).tap();
    await chooseNth(screen, 'Class', 1);
    await choose(screen, 'Site', /Cirebon/);
    await screen.getByLabel(L('Date acquired')).fill('2026-10-01');
    await screen.getByRole('button', 'Register').tap();
    // BUG: POST /api/v1/ga/assets with a taken asset_number answers 500 "database operation failed"
    // where users and suppliers answer a 409 "conflict: … already exists".
    await expect(screen.getByText(/already|duplicate|exists|taken|in use/i).first()).toBeVisible({ timeout: SLOW });
    expect(((await admin().get(`/api/v1/ga/assets?q=AST-${t}`)).rows as unknown[]).length).toBe(1);
  });

  test('GA-15b the API answers a duplicate asset code with a 409 conflict, not a 500', { tags: ['ga', 'bug'] }, async () => {
    const t = tag('DD');
    await registerAsset(t);
    const err = await admin().call('POST', '/api/v1/ga/assets', {
      asset_number: `AST-${t}`, name: 'Dup', class_code: 'OE_RAK_1', site_id: GA_SITE, sub_location: null, holder: null, condition: 'BAIK',
      serial_number: null, acquired_on: '2026-01-10', specs: { material: 'Besi', dim: '1', area: 'A', repl: 'ya' }, notes: null, quantity: null,
    }, { ok: false });
    expect(JSON.stringify(err)).toMatch(/conflict|already/i);
  });

  test('GA-16 Move needs a reason, takes the asset to the other site and writes it in History', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('F');
    const a = await registerAsset(t);
    await app.open(`/assets?asset=${a.asset_id}`);
    await screen.getByRole('button', 'Move').tap();
    const go = screen.getByRole('button', 'Move');
    await expect(go).toBeDisabled();
    await choose(screen, 'To site', 'store-c015');
    await expect(go).toBeDisabled(); // no reason yet
    await screen.getByLabel(L('Reason')).fill(`pindah e2e ${t}`);
    await expect(go).toBeEnabled();
    await go.tap();
    await expect.poll(async () => (await assetOf(a.asset_id)).asset.site_id, { timeout: SLOW }).toBe('store-c015');
    await screen.getByRole('tab', 'History').tap();
    await expect(screen.getByText(new RegExp(`pindah e2e ${t}`))).toBeVisible({ timeout: SLOW });
  });

  test('GA-17 Replace opens a proposal that then appears under Replacements', { session: 'rina', tags: ['ga'] }, async ({ app, screen, browser }) => {
    const t = tag('G');
    const a = await registerAsset(t);
    await app.open(`/assets?asset=${a.asset_id}`);
    await screen.getByRole('button', 'Replace').tap();
    await screen.getByLabel(L('Reason for replacement')).fill(`rusak parah ${t}`);
    await screen.getByRole('button', 'Propose replacement').tap();
    await expect.poll(async () => ((await admin().get('/api/v1/ga/replacements')).rows as { old_asset_id: string }[]).some((r) => r.old_asset_id === a.asset_id), { timeout: SLOW }).toBe(true);
    await app.open('/maintenance/replacements');
    await expect(screen.getByText(`Rak Uji ${t}`).first()).toBeVisible({ timeout: SLOW });
    await expect(browser).toHaveURL(/replacements/);
  });

  test('GA-18 Request disposal needs a reason; a request is then pending a decision', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('H');
    const a = await registerAsset(t);
    await app.open(`/assets?asset=${a.asset_id}`);
    await screen.getByRole('button', 'Request disposal').tap();
    await screen.getByRole('button', 'Request disposal').tap(); // no reason → refused on the form
    await expect(screen.getByLabel(L('Reason'))).toBeVisible();
    await screen.getByLabel(L('Reason')).fill(`dibuang ${t}`);
    await screen.getByRole('radio', { name: /^Scrap/ }).tap();
    await screen.getByRole('button', 'Request disposal').tap();
    await expect.poll(async () => ((await admin().get('/api/v1/ga/disposals')).rows as { asset_id: string; status: string }[]).find((r) => r.asset_id === a.asset_id)?.status, { timeout: SLOW }).toBeTruthy();
  });

  test('GA-19 the Needs-details book lists nothing of ours; Registered lists the asset', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('I');
    await registerAsset(t);
    await app.open('/assets');
    await screen.getByRole('textbox').first().fill(`AST-${t}`);
    await screen.getByRole('button', 'Needs details').tap();
    await expect(screen.getByText(`Rak Uji ${t}`)).toBeHidden({ timeout: SLOW });
    await screen.getByRole('button', 'Registered').tap();
    await expect(screen.getByText(`Rak Uji ${t}`)).toBeVisible({ timeout: SLOW });
  });

  test('GA-20 a search that matches nothing says there are no assets in this reading', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    await app.open('/assets');
    await screen.getByRole('textbox').first().fill('zzz-no-such-asset');
    await expect(screen.getByText(/No assets in this reading yet/)).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('button', 'Register the first one')).toBeVisible();
  });

  test('GA-21 phone: the register is cards with a round Register asset button', { session: 'rina', tags: ['ga'] }, async ({ app, screen, browser }) => {
    const t = tag('J');
    await registerAsset(t);
    await browser.setViewport(viewports.phone);
    await app.open('/assets');
    await expect(screen.getByRole('button', 'Register asset', { visible: true })).toBeVisible({ timeout: SLOW });
    await screen.getByRole('button', 'Search assets').tap();
    await screen.getByRole('searchbox', 'Search assets').fill(`AST-${t}`);
    await expect(screen.getByText(`Rak Uji ${t}`)).toBeVisible({ timeout: SLOW });
  });
});
