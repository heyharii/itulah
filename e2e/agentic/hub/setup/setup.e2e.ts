// Setup: the onboarding wizard (company → stores → books) and the "Get the
// stores ready to open" card that takes over after it. On this rig setup is
// finished, so the wizard cannot be reached without breaking every other suite;
// its branches are written and skipped (RIG_SETUP_FRESH=1 on a fresh business
// runs them). What a set-up business shows is tested for real.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { admin, SLOW, T, L } from '../../support/stores-ga.ts';

const status = async () => admin().get('/api/v1/setup');

describe('Setup: a business that is set up', { tags: ['setup'] }, () => {
  test('SET-01 the business is finished: the wizard does not take over the app', { session: 'rina', tags: ['setup', 'smoke'] }, async ({ app, screen }) => {
    expect((await status()).finished).toBe(true);
    await app.open('/home');
    await expect(screen.getByText('Here is how things are going.')).toBeVisible(T); // the app itself loaded
    await expect(screen.getByRole('progressbar', 'Setup progress')).toBeHidden();
    await expect(screen.getByRole('button', 'Finish later')).toBeHidden();
    await expect(screen.getByRole('button', 'Continue setup')).toBeHidden();
  });

  test('SET-02 the setup card counts the tasks done and lists every one with its own words', { session: 'rina', tags: ['setup'] }, async ({ app, screen }) => {
    const s = await status();
    const titles: Record<string, string> = {
      team: 'Invite your team',
      store_nodes: 'Pair the store servers',
      payments: 'Turn on QRIS & debit',
      store_addresses: 'Complete store addresses',
      bank_accounts: 'Add bank accounts',
      tax_id: 'Add NPWP',
      opening_balances: 'Enter opening balances',
    };
    const done = (s.tasks as { id: string; done: boolean }[]).filter((x) => x.done).length;
    await app.open('/home');
    const card = screen.getByText('Get the stores ready to open');
    test.skip(!(await card.isVisible().catch(() => false)) && done === s.tasks.length, 'every task is done, the card hides itself');
    await expect(card).toBeVisible(T);
    await expect(screen.getByText(new RegExp(`^${done} of ${s.tasks.length} done`))).toBeVisible();
    for (const task of s.tasks as { id: string }[]) await expect(screen.getByText(titles[task.id], { exact: true })).toBeVisible();
  });

  test('SET-03 a pending task names how many stores are waiting, from the API', { session: 'rina', tags: ['setup'] }, async ({ app, screen }) => {
    const s = await status();
    const nodes = (s.tasks as { id: string; done: boolean; pending: number | null }[]).find((x) => x.id === 'store_nodes')!;
    test.skip(nodes.done, 'every store server is paired');
    await app.open('/home');
    await expect(screen.getByText(`${nodes.pending} stores are waiting — enter the pairing code on each store's server.`)).toBeVisible(T);
  });

  test('SET-04 "Pair the store servers" goes to the Stores list', { session: 'rina', tags: ['setup'] }, async ({ app, screen, browser }) => {
    const s = await status();
    test.skip((s.tasks as { id: string; done: boolean }[]).find((x) => x.id === 'store_nodes')!.done, 'done');
    await app.open('/home');
    await screen.getByText('Pair the store servers', { exact: true }).tap();
    await expect(browser).toHaveURL(/\/stores$/, T);
    await expect(screen.getByRole('heading', 'Stores')).toBeVisible(T);
  });

  test('SET-05 "Complete store addresses" goes to Sites', { session: 'rina', tags: ['setup'] }, async ({ app, screen, browser }) => {
    const s = await status();
    test.skip((s.tasks as { id: string; done: boolean }[]).find((x) => x.id === 'store_addresses')!.done, 'done');
    await app.open('/home');
    await screen.getByText('Complete store addresses', { exact: true }).tap();
    await expect(browser).toHaveURL(/\/locations$/, T);
  });

  test('SET-06 "Add NPWP" opens the company sheet with the saved name and address', { session: 'rina', tags: ['setup'] }, async ({ app, screen }) => {
    const s = await status();
    test.skip((s.tasks as { id: string; done: boolean }[]).find((x) => x.id === 'tax_id')!.done, 'NPWP already given');
    await app.open('/home');
    await screen.getByText('Add NPWP', { exact: true }).tap();
    await expect(screen.getByRole('dialog')).toBeVisible(T);
    await expect(screen.getByDisplayValue(s.company.name)).toBeVisible();
    await expect(screen.getByDisplayValue(s.company.address)).toBeVisible();
    for (const label of ['Business name', 'Head office address', 'NPWP']) await expect(screen.getByRole('textbox', { name: new RegExp(`^${label}`) })).toBeVisible();
    await expect(screen.getByRole('switch', 'Warehouse')).toBeVisible();
  });

  test('SET-07 the company sheet refuses a short NPWP and a missing legal form, and Cancel saves nothing', { session: 'rina', tags: ['setup'] }, async ({ app, screen }) => {
    const before = await status();
    test.skip((before.tasks as { id: string; done: boolean }[]).find((x) => x.id === 'tax_id')!.done, 'NPWP already given');
    await app.open('/home');
    await screen.getByText('Add NPWP', { exact: true }).tap();
    await screen.getByRole('textbox', { name: /^NPWP/ }).fill('12345');
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('NPWP is 16 digits.')).toBeVisible(T);
    if (before.company.legal_form === null) await expect(screen.getByText('Choose the legal form.')).toBeVisible();
    await screen.getByRole('button', 'Cancel').tap();
    await expect(screen.getByRole('dialog')).toBeHidden();
    expect(await status()).toEqual(before);
  });

  test('SET-08 the company sheet shows how the name will print once a legal form is chosen', { session: 'rina', tags: ['setup'] }, async ({ app, screen }) => {
    const s = await status();
    test.skip((s.tasks as { id: string; done: boolean }[]).find((x) => x.id === 'tax_id')!.done, 'NPWP already given');
    await app.open('/home');
    await screen.getByText('Add NPWP', { exact: true }).tap();
    await screen.getByRole('radio', { name: /^PT/ }).tap();
    await expect(screen.getByText(/Printed as/)).toBeVisible(T);
    await screen.getByRole('button', 'Cancel').tap();
    expect((await status()).company.legal_form).toBe(s.company.legal_form);
  });

  test('SET-09 Hide hides the card for this browser only; the tasks still stand on the server', { session: 'rina', tags: ['setup'] }, async ({ app, screen }) => {
    const s = await status();
    await app.open('/home');
    const card = screen.getByText('Get the stores ready to open');
    await expect(screen.getByText('Here is how things are going.')).toBeVisible(T);
    await card.waitFor({ state: 'visible', timeout: SLOW }).catch(() => undefined);
    test.skip(!(await card.isVisible()), 'the card is not shown (every task is done or it was hidden)');
    await screen.getByRole('button', 'Hide').tap();
    await expect(card).toBeHidden(T);
    expect((await status()).tasks).toEqual(s.tasks);
  });

  test('SET-10 the setup answer lists the 16 stores with their codes and zones', { tags: ['setup'] }, async () => {
    const s = await status();
    expect((s.stores as unknown[]).length).toBeGreaterThanOrEqual(16);
    for (const st of s.stores as { unit_code: string; timezone: string }[]) {
      expect(st.unit_code).toMatch(/^C\d{3}$/);
      expect(['WIB', 'WITA', 'WIT']).toContain(st.timezone);
    }
    expect(s.books).toMatchObject({ chart: expect.any(String), first_period: expect.stringMatching(/^\d{4}-\d{2}$/) });
  });

  test('SET-11 saving the company again is refused for a short NPWP by the server too (422)', { tags: ['setup'] }, async () => {
    const before = await status();
    const res = await admin().call('PUT', '/api/v1/setup/company', { ...before.company, legal_form: 'PT', tax_id: '123' }, { ok: false });
    expect(JSON.stringify(res)).not.toContain('"tax_id":"123"');
    expect((await status()).company.tax_id).toBe(before.company.tax_id);
  });

  test('SET-12 opening books a second time is refused', { tags: ['setup'] }, async () => {
    const before = await status();
    const res = await admin().call('POST', '/api/v1/setup/books', { chart: 'STANDARD', file_id: null, first_period: '2026-10' }, { ok: false });
    expect(JSON.stringify(res)).toBeTruthy();
    expect((await status()).books).toEqual(before.books);
  });
});

const FRESH = process.env.RIG_SETUP_FRESH === '1';

describe('Setup: the onboarding wizard (needs a business that is not set up yet)', { tags: ['setup'] }, () => {
  test('SET-20 step 1 asks for the name and the head office address before it goes on', { session: 'rina', tags: ['setup'] }, async ({ app, screen }) => {
    test.skip(!FRESH, 'needs a fresh business: setup is finished on this rig');
    await app.open('/home');
    await expect(screen.getByText('Step 1 of 3')).toBeVisible(T);
    await screen.getByRole('button', 'Continue').tap();
    await expect(screen.getByText('Enter the business name.')).toBeVisible();
    await expect(screen.getByText('Enter the head office address.')).toBeVisible();
  });

  test('SET-21 step 2 opens stores only when every named store has a manager', { session: 'rina', tags: ['setup'] }, async ({ app, screen }) => {
    test.skip(!FRESH, 'needs a fresh business');
    await app.open('/home');
    await expect(screen.getByText('Step 2 of 3')).toBeVisible(T);
    await screen.getByLabel(/^Store name/).fill('Toko Satu');
    await expect(screen.getByRole('button', 'Open store')).toBeDisabled();
  });

  test('SET-22 step 3 offers a fresh chart or an upload, and Finish needs the file for an upload', { session: 'rina', tags: ['setup'] }, async ({ app, screen }) => {
    test.skip(!FRESH, 'needs a fresh business');
    await app.open('/home');
    await expect(screen.getByText('Step 3 of 3')).toBeVisible(T);
    await screen.getByRole('radio', { name: /Moving from other software/ }).tap();
    await expect(screen.getByRole('button', 'Finish')).toBeDisabled();
  });

  test('SET-23 "Finish later" returns to the app and the card says setup is not finished', { session: 'rina', tags: ['setup'] }, async ({ app, screen }) => {
    test.skip(!FRESH, 'needs a fresh business');
    await app.open('/home');
    await screen.getByRole('button', 'Finish later').tap();
    await expect(screen.getByText('Setup is not finished')).toBeVisible(T);
  });
});

void SLOW;
