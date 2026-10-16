// People › Finance: Claims (two-person rule, payout), Loans, Claim Types, Yearly Allowances.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { HR, claimOf, fileClaim, hire, pickDay, pickOne, selectOne, submitClaim, tag, today } from '../../support/people.ts';

const LOAD = { timeout: 45_000 };

async function submitted(amount = 120_000) {
  const h = await hire(tag('C'));
  const claim = await fileClaim(h.id, { amount });
  await submitClaim(claim.claim_id);
  return { h, claim };
}

describe('People: claims', { tags: ['people'] }, () => {
  test('HR-50 File claim sheet files and sends a claim for someone', { session: 'rina', tags: ['people', 'smoke'] }, async ({ app, screen }) => {
    const h = await hire(tag('F'));
    await app.open('/people/claims');
    await screen.getByRole('button', 'File claim').first().tap();
    const sheet = screen.getByRole('dialog');
    await selectOne(screen, /^For/, h.name);
    await selectOne(screen, /^Kind of expense/, 'Transport dinas');
    await pickDay(screen, /^Spent on/, today());
    await sheet.getByRole('spinbutton', /^Amount/).fill('95000');
    await sheet.getByRole('textbox', /^What for/).fill('Taksi ke gudang');
    await sheet.getByRole('textbox', /^Why this claim/).fill('Antar sampel ke gudang');
    await sheet.getByRole('button', 'File and send it').tap();
    await expect(screen.getByRole('dialog')).toBeHidden(LOAD);
    const list = (await HR().get(`/api/v1/employees/${h.id}/expense-claims`)) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ state: 'SUBMITTED', claimed_minor: 95_000, unit_id: 'store-01' });
    expect(list[0].lines[0]).toMatchObject({ type_code: 'TRANSPORT', description: 'Taksi ke gudang' });
  });

  test('HR-51 a second person approves a claim and sanctions the figure; Approve is needed before any money moves', { session: 'admin', tags: ['people'] }, async ({ app, screen }) => {
    const { h, claim } = await submitted(120_000);
    await app.open(`/people/claims?claim=${claim.claim_id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', claim.claim_number)).toBeVisible(LOAD);
    await expect(sheet).toContainText('not decided yet');
    await sheet.getByRole('textbox', /^Why/).first().fill('Sesuai bukti');
    await sheet.getByRole('button', 'Approve').tap();
    await expect.poll(async () => (await claimOf(h.id, claim.claim_id)).state, { timeout: 20_000 }).toBe('APPROVED');
    const after = await claimOf(h.id, claim.claim_id);
    expect(after.sanctioned_minor).toBe(120_000);
    expect(after.decided_by).toBe('admin');
    expect(after.paid_at).toBeNull();
  });

  test('HR-52 sanctioning less than claimed approves the lower figure', { session: 'admin', tags: ['people'] }, async ({ app, screen }) => {
    const { h, claim } = await submitted(120_000);
    await app.open(`/people/claims?claim=${claim.claim_id}`);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('spinbutton').fill('100000');
    await sheet.getByRole('textbox', /^Why/).first().fill('Tarif taksi dipotong ke batas kebijakan');
    await sheet.getByRole('button', 'Approve').tap();
    await expect.poll(async () => (await claimOf(h.id, claim.claim_id)).state, { timeout: 20_000 }).toBe('APPROVED');
    expect((await claimOf(h.id, claim.claim_id)).sanctioned_minor).toBe(100_000);
  });

  test('HR-53 Refuse closes the claim for good', { session: 'admin', tags: ['people'] }, async ({ app, screen }) => {
    const { h, claim } = await submitted(50_000);
    await app.open(`/people/claims?claim=${claim.claim_id}`);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', /^Why/).first().fill('Tidak ada bukti');
    await sheet.getByRole('button', 'Refuse').tap();
    await expect.poll(async () => (await claimOf(h.id, claim.claim_id)).state, { timeout: 20_000 }).toBe('REJECTED');
    await app.open(`/people/claims?claim=${claim.claim_id}`);
    await expect(screen.getByRole('dialog')).toContainText('Refused. There is no way back from here', LOAD);
  });

  test('HR-54 Send back returns the claim to the filer to amend', { session: 'admin', tags: ['people'] }, async ({ app, screen }) => {
    const { h, claim } = await submitted(70_000);
    await app.open(`/people/claims?claim=${claim.claim_id}`);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', /^Why/).first().fill('Lampirkan struk');
    await sheet.getByRole('button', 'Send back').tap();
    await expect.poll(async () => (await claimOf(h.id, claim.claim_id)).state, { timeout: 20_000 }).toBe('DRAFT');
  });

  test('HR-55 whoever filed a claim does not decide it: the server refuses and the claim stays waiting', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const { h, claim } = await submitted(60_000);
    await app.open(`/people/claims?claim=${claim.claim_id}`);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', /^Why/).first().fill('Saya setujui sendiri');
    await sheet.getByRole('button', 'Approve').tap();
    await expect(sheet.getByText(/filed|same|own|another|cannot|may not/i).first()).toBeVisible(LOAD);
    expect((await claimOf(h.id, claim.claim_id)).state).toBe('SUBMITTED');
  });

  test('HR-56 the filer can take a waiting claim back', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const { h, claim } = await submitted(45_000);
    await app.open(`/people/claims?claim=${claim.claim_id}`);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', /^Why/).last().fill('Salah input jumlah');
    await sheet.getByRole('button', 'Take it back').tap();
    await expect.poll(async () => (await claimOf(h.id, claim.claim_id)).state, { timeout: 20_000 }).not.toBe('SUBMITTED');
  });

  test('HR-57 an approved claim is paid from the unit\'s petty cash', { session: 'admin', tags: ['people'] }, async ({ app, screen }) => {
    const { h, claim } = await submitted(80_000);
    await HR().call('POST', `/api/v1/expense-claims/${claim.claim_id}/decision`, { approve: true, reason: 'Sesuai', lines: [] }, { ok: false });
    // The decision body is the sheet's: approve through it if the shortcut above was not accepted.
    if ((await claimOf(h.id, claim.claim_id)).state === 'SUBMITTED') {
      await app.open(`/people/claims?claim=${claim.claim_id}`);
      const sheet = screen.getByRole('dialog');
      await sheet.getByRole('textbox', /^Why/).first().fill('Sesuai');
      await sheet.getByRole('button', 'Approve').tap();
      await expect.poll(async () => (await claimOf(h.id, claim.claim_id)).state, { timeout: 20_000 }).toBe('APPROVED');
    }
    await app.open(`/people/claims?claim=${claim.claim_id}`);
    await screen.getByRole('button', 'Pay from petty cash').tap();
    await expect.poll(async () => (await claimOf(h.id, claim.claim_id)).state, { timeout: 20_000 }).toBe('PAID');
    expect((await claimOf(h.id, claim.claim_id)).paid_at).not.toBeNull();
  });
});

describe('People: claim types and yearly allowances', { tags: ['people'] }, () => {
  test('HR-58 New type defines a kind of expense; Cancel it retires it', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const code = `ZT${tag('')}`.toUpperCase();
    await app.open('/people/claim-types');
    await screen.getByRole('button', 'New type').first().tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', /^Code/).fill(code);
    await sheet.getByRole('textbox', /^Name/).fill(`Jenis ${code}`);
    await selectOne(screen, /^Expense category/, /\(expense_/);
    await sheet.getByRole('button', 'Define it').tap();
    await expect(screen.getByRole('dialog')).toBeHidden(LOAD);
    await expect(screen.getByRole('row', { name: new RegExp(code) })).toContainText('In use', LOAD);
    await screen.getByRole('button', code).tap();
    await screen.getByRole('dialog').getByRole('textbox', /^Why/).fill('Tidak dipakai lagi');
    await screen.getByRole('dialog').getByRole('button', 'Cancel it').tap();
    await expect.poll(async () => ((await HR().get('/api/v1/expense-claim-types')) as any[]).find((t) => t.code === code)?.retired_at, { timeout: 20_000 }).toBeTruthy(); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  test('HR-59 Set allowance gives one kind a yearly limit per person', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const code = `ZA${tag('')}`.toUpperCase();
    await HR().post('/api/v1/expense-claim-types', { code, name: `Batas ${code}`, expense_category: 'expense_misc' });
    await app.open('/people/claim-allowances');
    await screen.getByRole('button', 'Set allowance').first().tap();
    const sheet = screen.getByRole('dialog');
    await pickOne(screen, 'Kind', `Batas ${code}`);
    await pickDay(screen, /^From/, `${new Date().getUTCFullYear()}-01-01`);
    await sheet.getByRole('textbox', /^A year, per person/).fill('1500000');
    await sheet.getByRole('textbox', /^Why/).fill('Batas tahunan baru');
    await sheet.getByRole('button', 'Save allowance').tap();
    await expect(screen.getByRole('dialog')).toBeHidden(LOAD);
    await expect(screen.getByText(`Batas ${code}`)).toBeVisible(LOAD);
    await expect(screen.getByText(/1\.500\.000/).first()).toBeVisible();
  });
});

describe('People: loans', { tags: ['people'] }, () => {
  test('HR-60 Grant a loan from the employee sheet: it shows as running and on the Loans list', { session: 'rina', tags: ['people', 'bug'] }, async ({ app, screen }) => {
    // Grant answers 500 "database operation failed": migration 0701 dropped advance_number_seq,
    // while pay.rs grant_loan still numbers the advance with nextval('advance_number_seq').
    const h = await hire(tag('LN'));
    await app.open(`/people?employee=${h.id}#loans`);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', /^Amount/).fill('1200000');
    await sheet.getByRole('textbox', /^Instalments/).fill('4');
    await sheet.getByRole('textbox', /^For/).fill('Uang muka sewa kos');
    await sheet.getByRole('textbox', /^Why/).fill('Kasbon disetujui atasan');
    await sheet.getByRole('button', 'Grant loan').tap();
    await expect(sheet.getByText('No loan.')).toBeHidden(LOAD);
    const loans = (await HR().get(`/api/v1/employees/${h.id}/loans`)) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ amount_minor: 1_200_000, instalment_minor: 300_000 });
  });

  test('HR-61 the Loans list names the loan and who has repaid what', { session: 'rina', tags: ['people', 'bug'] }, async ({ app, screen }) => {
    const h = await hire(tag('LM'));
    await HR().post(`/api/v1/employees/${h.id}/loans`, { amount_minor: 900_000, instalment_minor: 300_000, first_period: '2026-11', purpose: 'Kasbon', reason: 'Uji e2e' });
    await app.open('/people/loans');
    await expect(screen.getByRole('row', { name: new RegExp(h.name) })).toContainText('Rp 900.000', LOAD);
  });
});
