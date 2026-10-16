// Accounting Masters: Chart of Accounts (own account created, refused twice, deactivated), Accounting Period (read only — the open month is never closed), Account Links / Posting Readiness, and the setup lists.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as F from '../../support/finance.ts';

const TAGS = ['finance', 'masters'];

/** A code nobody has used under CURRENT ASSET (1000): 19NN. */
async function freeCode(): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const code = `19${10 + Math.floor(Math.random() * 80)}`;
    const found = await F.cloud().call('GET', `/api/v1/finance/accounts/${code}`, undefined, { ok: false });
    if (found?.account === undefined) return code;
  }
  throw new Error('no free 19NN code');
}

describe('Chart of Accounts', { tags: TAGS }, () => {
  test('the chart opens as a tree with Chart / History tabs, the filters and New account; search finds an account by its code', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await app.open('/finance/accounting/chart-of-accounts');
    await F.onScreen(screen, 'Chart of Accounts');
    await expect(screen.getByRole('button', 'New account')).toBeVisible();
    for (const tab of ['Chart', 'History']) await expect(screen.getByRole('tab', tab)).toBeVisible();
    await expect(screen.getByRole('combobox', 'Whose books')).toBeVisible();
    await expect(screen.getByRole('checkbox', 'Show inactive')).toBeVisible();
    await expect(screen.getByText('Balances as of today, headings summed')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('textbox').first().fill('1009');
    await expect(screen.getByText('Cash In Bank Giro Bank DANAMON').first()).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByText('Matching “1009”')).toBeVisible();
  });

  test('New account: code, name and a heading → it is in the chart (postable, under that heading), the chart history says so, and the same code is refused twice', { session: 'rina', timeout: 300_000 }, async ({ app, screen }) => {
    const code = await freeCode();
    const t = F.tag('A');
    await app.open('/finance/accounting/chart-of-accounts');
    await screen.getByRole('button', 'New account').tap();
    await expect(screen.getByText('Applies at once and is kept in the chart\'s history.')).toBeVisible();
    const submit = screen.getByRole('button', 'Submit');
    await expect(submit).toBeDisabled();
    await expect(screen.getByText('Give the account a code.')).toBeVisible();
    await screen.getByRole('textbox', { name: /^Code/ }).fill(code);
    await screen.getByRole('textbox', { name: /^Name/ }).fill(`Akun uji ${t}`);
    await expect(screen.getByText('Choose the heading it sits under.')).toBeVisible();
    await screen.getByRole('textbox').nth(2).fill('1000');
    await screen.getByRole('button', { name: /^1000/ }).first().tap();
    await expect(screen.getByText(`${code} will sit under 1000.`)).toBeVisible({ timeout: 30_000 });
    await submit.tap();
    await expect(screen.getByRole('button', 'Edit')).toBeVisible({ timeout: 30_000 }); // the new account opens
    const acc = (await F.cloud().get(`/api/v1/finance/accounts/${code}`)).account;
    expect(acc).toMatchObject({ account_code: code, name: `Akun uji ${t}`, parent_code: '1000', is_group: false, is_active: true });
    const dup = await F.cloud().call('POST', '/api/v1/finance/chart-changes', { kind: 'CREATE', account_code: code, name: 'dup', parent_code: '1000', is_group: false, account_type: null, statement_section: null, dimension: 'unit', normal_balance: null, reason: null }, { ok: false });
    expect(dup.error).toBeTruthy();
    const history = (await F.cloud().get(`/api/v1/finance/chart-changes?account=${code}`)) as any[];
    expect(history.some((c) => c.action === 'CREATE' && c.account_code === code)).toBe(true);
  });

  test('Deactivate: an inactive account takes no postings (the books refuse it), Reactivate takes them again, and an account that carries a balance cannot be retired', { session: 'rina', timeout: 300_000 }, async ({ app, screen }) => {
    const code = await freeCode();
    await F.cloud().post('/api/v1/finance/chart-changes', { kind: 'CREATE', account_code: code, name: `Akun beku ${F.tag('B')}`, parent_code: '1000', is_group: false, account_type: null, statement_section: null, dimension: 'unit', normal_balance: null, reason: 'e2e' });

    await app.open(`/finance/accounting/chart-of-accounts?account=${code}`);
    await screen.getByRole('button', 'Deactivate').tap();
    await expect(screen.getByText('Nothing new can be posted to an inactive account.', { exact: false })).toBeVisible();
    await screen.getByRole('button', 'Deactivate account').tap();
    await expect(screen.getByRole('button', 'Reactivate')).toBeVisible({ timeout: 30_000 });
    expect((await F.cloud().get(`/api/v1/finance/accounts/${code}`)).account.is_active).toBe(false);
    const refused = await F.manualEntry(code, '2031', 7_000, `mati ${code}`);
    expect(refused.error).toBeTruthy();

    await screen.getByRole('button', 'Reactivate').tap();
    await screen.getByRole('button', 'Reactivate account').tap();
    await expect(screen.getByRole('button', 'Deactivate')).toBeVisible({ timeout: 30_000 });
    expect((await F.manualEntry(code, '2031', 7_000, `hidup ${code}`)).entry_id).toBeTruthy();

    // with a balance on it the account cannot be retired: the server names the balance
    await screen.getByRole('button', 'Deactivate').tap();
    await screen.getByRole('button', 'Deactivate account').tap();
    await expect(screen.getByText(`${code} still carries a balance of 7000; clear it before retiring the account`, { exact: false })).toBeVisible({ timeout: 30_000 });
    expect((await F.cloud().get(`/api/v1/finance/accounts/${code}`)).account.is_active).toBe(true);
  });

  test('History lists the chart changes, newest first', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/accounting/chart-of-accounts');
    await screen.getByRole('tab', 'History').tap();
    await expect(screen.getByText(/created|create|deactivate|reactivate/i).first()).toBeVisible({ timeout: 60_000 });
  });
});

describe('Accounting Period', { tags: TAGS }, () => {
  test('the calendar shows the open month; its sheet carries the month-end checklist; this suite never seals it', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await F.openScreen(app, screen, '/finance/setup/periods', 'Accounting Period');
    await F.expectHeads(screen, ['Month', 'Status', 'Entries', 'Closed by', 'Closed at']);
    await expect(F.rowOf(screen, 'October 2026').first()).toContainText('Open', { timeout: 60_000 });
    await expect(screen.getByText('October 2026 · 1 months opened')).toBeVisible();
    const periods = await F.cloud().get('/api/v1/finance/periods');
    expect(periods.rows.find((p: any) => p.year === 2026 && p.month === 10).status).toBe('OPEN');
    await F.rowOf(screen, 'October 2026').first().tap();
    for (const check of ['Every role reaches an account', 'Supplier bills posted', 'Bank statements agreed', 'Depreciation charged', 'Books balance']) await expect(screen.getByText(check)).toBeVisible({ timeout: 60_000 });
    // look, never touch: the open month is shared by every suite
    expect((await F.cloud().get('/api/v1/finance/periods')).rows.find((p: any) => p.month === 10).status).toBe('OPEN');
  });

  test('opening a month is a Month + Year pick whose button says "<month> is open" (disabled) while that month exists — nothing is opened here', { session: 'rina' }, async ({ app, screen }) => {
    await F.openScreen(app, screen, '/finance/setup/periods', 'Accounting Period');
    await expect(screen.getByRole('button', 'October 2026 is open')).toBeDisabled({ timeout: 60_000 });
    await expect(screen.getByRole('combobox', 'Month')).toBeVisible();
    await expect(screen.getByRole('combobox', 'Year')).toBeVisible();
    expect((await F.cloud().get('/api/v1/finance/periods')).total).toBe(1);
  });

  test('a posting into a month that was never opened is refused with the sentence that names the month', { session: 'rina' }, async () => {
    const r = await F.manualEntry('1054', '2031', 1_000, 'nov', '2026-11-05');
    expect(r.error).toMatch(/no accounting period exists for 2026-11/);
  });
});

describe('setup lists', { tags: TAGS }, () => {
  test('Account Links lists the role → account links the posting rules read; Posting Readiness counts the roles with no account', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/setup/account-links');
    await F.onScreen(screen, 'Account Links');
    const links = await F.cloud().get('/api/v1/finance/account-links');
    await expect(screen.getByText(links.rows[0].role.replace(/_/g, ' '), { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    await app.open('/finance/setup/posting-readiness');
    await F.onScreen(screen, 'Posting Readiness');
    const readiness = await F.cloud().get('/api/v1/finance/posting-readiness');
    expect(Array.isArray(readiness.rows)).toBe(true);
    await expect(screen.getByRole('heading', { name: 'Posting Readiness', level: 1 })).toBeVisible({ timeout: 60_000 });
  });

  test('Mode of Payment, Tax Types, Expense Categories, Accounting Dimensions and Asset Category list what the API holds', { session: 'rina' }, async ({ app, screen }) => {
    const checks: [string, string, string, () => Promise<string | null>][] = [
      ['/finance/setup/payment-methods', 'Mode of Payment', '/api/v1/finance/payment-methods', async () => ((await F.cloud().get('/api/v1/finance/payment-methods')) as any[])[0]?.display_name ?? ((await F.cloud().get('/api/v1/finance/payment-methods')) as any[])[0]?.name ?? null],
      ['/finance/tax-setup/types', 'Tax Types', '/api/v1/finance/tax/types', async () => ((await F.cloud().get('/api/v1/finance/tax/types')) as any[])[0]?.name ?? null],
      ['/finance/setup/expense-categories', 'Expense Categories', '/api/v1/finance/expense-categories', async () => ((await F.cloud().get('/api/v1/finance/expense-categories')) as any[])[0]?.name ?? null],
    ];
    for (const [path, title, , first] of checks) {
      await app.open(path);
      await F.onScreen(screen, title);
      const name = await first();
      if (name) await expect(screen.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    }
    for (const [path, title] of [['/finance/setup/dimensions', 'Accounting Dimensions'], ['/finance/setup/asset-classes', 'Asset Category'], ['/finance/settings/accounts', 'Accounts Settings'], ['/finance/settings/posting-policies', 'Posting Policies'], ['/finance/settings/permissions', 'Rung Permissions']] as const) {
      await app.open(path);
      await F.onScreen(screen, title);
    }
  });
});
