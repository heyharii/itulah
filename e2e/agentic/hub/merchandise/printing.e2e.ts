// Ops › Printing (screens/operations/tagging): the labels of an issued article, printed per PO, then tagged.
// The rig's label sink (port 9109, as in support/inventory.ts) stands in for the printer; the DC node dials it.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, nudge, rows, waitFor } from '../../support/rig.ts';
import { LABEL_SINK_PORT } from '../../support/inventory.ts';
import { newArticle, shared, SLOW, tag, type NewArticle } from '../../support/merchandise.ts';

const TAGS = ['merchandise', 'printing'];
let mine: NewArticle;

async function jobOf(po: string) {
  return waitFor(`tagging job for ${po}`, async () => {
    await nudge('cloud', 'dc');
    return rows(await as('dc', 'nina').get('/api/v1/dc/tagging-jobs')).find((j) => j.po_number === po);
  }, 180_000);
}

/** Printed = the DC no longer lists the job as open (printing everything confirms the tagging) or its session is complete. */
async function isPrinted(a: NewArticle) {
  const job = rows(await as('dc', 'nina').get('/api/v1/dc/tagging-jobs')).find((j) => j.po_number === a.stock.poNumber);
  if (!job) return true;
  const run = (await as('dc', 'nina').get(`/api/v1/dc/tagging-jobs/${job.job_id}/print-session`))?.session;
  return !!run && run.pending_count === 0 && run.failed_count === 0 && run.printed_count >= job.total_quantity;
}

/** Print an article's labels the way support/inventory.ts does, without the UI. */
async function printByApi(a: NewArticle) {
  const nina = as('dc', 'nina');
  const job = await jobOf(a.stock.poNumber);
  const sess = await nina.post('/api/v1/dc/print-sessions', { job_id: job.job_id, printer_host: '127.0.0.1', printer_port: LABEL_SINK_PORT, label_width_mm: 58, label_height_mm: 40, chunk_size: 10, actor_id: 'nina' });
  for (let i = 0; i < 5; i++) await nina.call('POST', `/api/v1/dc/print-sessions/${sess.session_id}/run`, { actor_id: 'nina' });
  await nina.post('/api/v1/dc/tagging-confirmations', { job_id: job.job_id, actor_id: 'nina', idempotency_key: crypto.randomUUID() });
}

/** An issued article whose labels are not printed yet. Printing consumes it, so each run builds its own. */
async function toPrint() {
  mine = await shared('merch-print', async () => {
    const a = await newArticle(8, tag('PR'));
    await jobOf(a.stock.poNumber);
    return a;
  }, async (a) => !(await isPrinted(a)), 2 * 3600_000);
  return mine;
}

const rowOf = (screen: any, text: string) => screen.getByRole('row').filter({ hasText: text });

/** Point this browser's printer at the label sink. */
async function pointPrinter(screen: any) {
  await screen.getByRole('button', /^Printer/).tap();
  await screen.getByRole('textbox', { name: /^Printer host/ }).fill('127.0.0.1');
  await screen.getByRole('textbox', { name: /^Port/ }).fill(String(LABEL_SINK_PORT));
}

describe('Ops Printing', { session: 'nina', tags: TAGS, timeout: 700_000 }, () => {
  test('MER-150 an issued article waits under To print with its PO, SKUs and pieces', { tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await toPrint();
    await app.open('/operations/tagging');
    await expect(screen.getByRole('heading', 'Printing')).toBeVisible(SLOW);
    const row = rowOf(screen, mine.stock.poNumber);
    await expect(row).toBeVisible({ timeout: 90_000 });
    await expect(row).toContainText('4'); // SKUs
    await expect(row).toContainText('8'); // pieces
    await expect(row.getByRole('button', 'Print 8')).toBeVisible();
    await expect(screen.getByRole('tab', /^To print/)).toBeVisible();
    await expect(screen.getByRole('tab', 'Printed')).toBeVisible();
  });

  test('MER-151 the PO sheet lists each SKU with article, color, size and pieces, and previews the label', { tags: TAGS }, async ({ app, screen }) => {
    await toPrint();
    await app.open(`/operations/tagging?job=po:${mine.stock.poNumber}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText(mine.stock.poNumber, { timeout: 90_000 });
    for (const word of [mine.name, 'Black', 'White', 'M', 'L', 'Article', 'Color', 'Size']) await expect(sheet).toContainText(word);
    await expect(sheet.getByText('Size', { exact: true }).first()).toBeVisible();
    await expect(sheet).toContainText('EPC', SLOW);
    await expect(sheet.getByRole('button', 'Print all 8')).toBeVisible();
  });

  test('MER-152 the Printer card says which machine this browser talks to and tests the connection', { tags: TAGS }, async ({ app, screen }) => {
    await toPrint();
    await app.open(`/operations/tagging?job=po:${mine.stock.poNumber}`);
    await expect(screen.getByRole('dialog')).toContainText(mine.stock.poNumber, { timeout: 90_000 });
    await pointPrinter(screen);
    await expect(screen.getByRole('button', /^Printer/)).toContainText(`127.0.0.1:${LABEL_SINK_PORT}`);
    await screen.getByRole('button', 'Test connection').tap();
    await expect(screen.getByText('answered')).toBeVisible(SLOW);
  });

  test('MER-153 Print all prints every label, tags the pieces and moves the PO to Printed', { tags: TAGS }, async ({ app, screen }) => {
    await toPrint();
    await app.open(`/operations/tagging?job=po:${mine.stock.poNumber}`);
    await expect(screen.getByRole('dialog')).toContainText(mine.stock.poNumber, { timeout: 90_000 });
    await pointPrinter(screen);
    // The printer is a shared sink: a label can fail when another suite prints at the same moment, and the button
    // then reads "Print all <left>" again — pressing it is exactly what a user does.
    for (let attempt = 0; attempt < 3 && !(await isPrinted(mine)); attempt++) {
      await screen.getByRole('dialog').getByRole('button', /^Print all \d+$/).tap();
      await expect.poll(() => isPrinted(mine), { timeout: 60_000, interval: 2_000 }).toBe(true).catch(() => undefined);
    }
    expect(await isPrinted(mine)).toBe(true);
  });

  test('MER-154 a printed PO sits under Printed and offers Reprint per SKU — BUG: Printed stays empty, a confirmed job leaves the DC list', { tags: [...TAGS, 'bug'] }, async ({ app, screen }) => {
    mine = await shared('merch-print', async () => {
      const a = await newArticle(8, tag('PR'));
      await printByApi(a);
      return a;
    }, async (a) => isPrinted(a), 2 * 3600_000);
    await app.open('/operations/tagging');
    await expect(screen.getByRole('heading', 'Printing')).toBeVisible(SLOW);
    await screen.getByRole('tab', 'Printed').tap();
    await expect(rowOf(screen, mine.stock.poNumber)).toBeVisible({ timeout: 90_000 });
    await rowOf(screen, mine.stock.poNumber).tap();
    await expect(screen.getByRole('dialog').getByRole('button', 'Reprint').first()).toBeVisible(SLOW);
  });
});
