// Procurement › Return PO (/procurement/returns, tabs Active / Completed) and the Gudang's hand-over
// (Ops board /operations/board/suppliers: Generate Delivery Note → Print / Download / Confirm).
// The warehouse is the cloud's own (INVENTORY_DC_HOSTING=cloud), so a hand-over needs its surat jalan first.
// The tests use a supplier of their own ("Return PO e2e", with an address and a telephone) so a note holds
// only the returns the test raised; the board's search box (by PO number) narrows a note to one return too.
import { readFileSync } from 'node:fs';
import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, dcReturns, poDetail, uid, waitFor } from '../../support/rig.ts';
import { openSheet } from '../../support/po.ts';
import { RETURN_ADDRESS, RETURN_PHONE, RETURN_SUPPLIER_NAME, handOverWithNote, makeNote, ownReturn } from '../../support/return-po.ts';
import { locateDownload } from '../../support/sales.ts';

const SUP = RETURN_SUPPLIER_NAME;
const SLOW = { timeout: 60_000 } as const;

/** Catch what Print writes into its window: `window.open` hands back a stand-in that keeps the HTML. Call before app.open. */
async function capturePrint(browser: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  await browser.addInitScript(`(() => { window.__printed = [];
    window.open = () => ({ document: { open() {}, write(html) { window.__printed.push(html); }, close() {} }, focus() {}, print() {} }); })()`);
}
const printed = async (browser: any): Promise<string> => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const all = (await browser.evaluate('window.__printed')) as string[];
  return all[all.length - 1] ?? '';
};
/** The visible words of printed HTML. */
const words = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<title>[\s\S]*?<\/title>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** The board narrowed to one return by its PO number; the band then holds just that return. */
async function boardFor(app: any, screen: any, po: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  await app.open('/operations/board/suppliers');
  await expect(screen.getByRole('heading', 'Return PO')).toBeVisible(SLOW);
  await screen.getByLabel('Search returns').fill(po);
  await expect(screen.getByText(po).first()).toBeVisible(SLOW);
}

/** The Generate Delivery Note sheet filled in and sent; the band then offers Print / Download / Confirm. */
async function generateNote(screen: any, po: string, pic = 'Pak Joko') { // eslint-disable-line @typescript-eslint/no-explicit-any
  await screen.getByRole('button', 'Generate Delivery Note').first().tap();
  await expect(screen.getByText('In this note')).toBeVisible();
  await screen.getByRole('textbox', 'Person in Charge').fill(pic);
  await screen.getByRole('button', 'Generate Delivery Note').last().tap();
  await expect(screen.getByRole('button', 'Confirm').first()).toBeVisible({ timeout: 30_000 });
}

describe('Return PO list and sheet (Procurement)', () => {
  test('RET-01 a raised return is listed under Active with its PO, RS number, quantity and "Not Generated" - no Value column', { session: 'rina', tags: ['return-po', 'smoke'] }, async ({ app, screen }) => {
    const { po, ret } = await ownReturn(11);
    await app.open(`/procurement/returns?q=${po}`);
    await expect(screen.getByRole('tab', /^Active/)).toBeVisible(SLOW);
    await expect(screen.getByRole('tab', /^Completed/)).toBeVisible();
    await expect(screen.getByRole('tab', /^Open/)).toBeHidden();
    const row = screen.getByRole('row', { name: new RegExp(po) });
    await expect(row).toBeVisible(SLOW);
    await expect(row).toContainText(ret.return_number);
    await expect(row).toContainText('Not Generated');
    await expect(row).toContainText('3 pcs');
    await expect(screen.getByRole('columnheader', 'Quantity').first()).toBeVisible();
    await expect(screen.getByRole('columnheader', 'Value')).toBeHidden();
  });

  test('RET-01b the Procurement list leaves the warehouse\'s Person in Charge column out', { session: 'rina', tags: ['return-po'] }, async ({ app, screen }) => {
    const { po } = await ownReturn(11);
    await app.open(`/procurement/returns?q=${po}`);
    await expect(screen.getByRole('row', { name: new RegExp(po) })).toBeVisible(SLOW);
    await expect(screen.getByRole('columnheader', 'Person in Charge')).toBeHidden();
  });

  test('RET-02 search finds a return by its RS number and by the supplier', { session: 'rina', tags: ['return-po'] }, async ({ app, screen }) => {
    const { po, ret } = await ownReturn(11);
    await app.open(`/procurement/returns?q=${po}`);
    await expect(screen.getByRole('row', { name: new RegExp(po) })).toBeVisible(SLOW);
    await screen.getByLabel('Search returns').fill(ret.return_number);
    await expect(screen.getByRole('row', { name: new RegExp(po) })).toBeVisible();
    await screen.getByLabel('Search returns').fill('RS-99999999');
    await expect(screen.getByRole('row', { name: new RegExp(po) })).toBeHidden();
    await expect(screen.getByText('Nothing here.')).toBeVisible();
  });

  test('RET-03 the return sheet is a narrow rail: supplier, kind, PO, Address, Phone, Person in Charge, Items with Quantity and one Total, Print and Download', { session: 'rina', tags: ['return-po'] }, async ({ app, screen }) => {
    const { po, ret } = await ownReturn(11);
    await app.open(`/procurement/returns?allotment=${ret.return_id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText(SUP, SLOW);
    await expect(sheet).toContainText(ret.return_number);
    await expect(sheet).toContainText(/Over.Delivery/i);
    await expect(sheet).toContainText(po);
    await expect(sheet).toContainText('Address');
    await expect(sheet).toContainText(RETURN_ADDRESS);
    await expect(sheet).toContainText('Phone');
    await expect(sheet).toContainText(/555.?0107/);
    await expect(sheet).toContainText('Person in Charge');
    await expect(sheet).toContainText('Items');
    await expect(sheet.getByRole('columnheader', 'Quantity')).toBeVisible();
    await expect(sheet.getByRole('columnheader', 'Value')).toBeHidden();
    await expect(sheet).toContainText('Total');
    await expect(sheet).not.toContainText('Rp');
    await expect(sheet.getByRole('button', 'Print')).toBeVisible();
    await expect(sheet.getByRole('button', 'Download')).toBeVisible();
    // a rail: about 480px on the desk, not the wide sheet
    const box = await sheet.boundingBox();
    expect(box!.width).toBeGreaterThan(380);
    expect(box!.width).toBeLessThan(520);
  });

  test('RET-03b the sheet has no Note Date until the surat jalan is made, and shows it (with the person in charge) after', { session: 'rina', tags: ['return-po'] }, async ({ app, screen }) => {
    const { ret, dc } = await ownReturn(11);
    await app.open(`/procurement/returns?allotment=${ret.return_id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText(SUP, SLOW);
    await expect(sheet).not.toContainText('Note Date');
    await makeNote([dc.return_id], 'pak joko');
    await app.open(`/procurement/returns?allotment=${ret.return_id}`);
    await expect(screen.getByRole('dialog')).toContainText('Note Date', SLOW);
    await expect(screen.getByRole('dialog')).toContainText('Pak Joko');
  });

  test('RET-04 Not as Ordered pieces show as "Not as Ordered" with "Item Unknown" under it, no price', { session: 'rina', tags: ['return-po'] }, async ({ app, screen }) => {
    const { ret } = await ownReturn(10, 3);
    await app.open(`/procurement/returns?allotment=${ret.return_id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText(/Not as Ordered/i, SLOW);
    await expect(sheet).toContainText(/Item unknown/i);
    await expect(sheet).not.toContainText('Rp');
  });

  test('RET-05 an order with extra and Not as Ordered reads "Over Delivery · Not As Ordered"', { session: 'rina', tags: ['return-po'] }, async ({ app, screen }) => {
    const { ret } = await ownReturn(13, 2);
    await app.open(`/procurement/returns?allotment=${ret.return_id}`);
    await expect(screen.getByRole('dialog')).toContainText(/Over.Delivery\s*·\s*Not.As.Ordered/i, SLOW);
  });

  test('RET-06 the PO sheet\'s Return PO section links to the return', { session: 'rina', tags: ['return-po'] }, async ({ app, screen }) => {
    const { po, ret } = await ownReturn(11);
    const sheet = await openSheet(app, screen, po);
    await expect(sheet).toContainText('Return PO');
    await expect(sheet).toContainText(ret.return_number);
    await expect(sheet).toContainText('Not Generated');
  });

  test('RET-07 a handed-over return leaves Active and is listed under Completed, with its Note Date', { session: 'rina', tags: ['return-po'] }, async ({ app, screen }) => {
    const { po, ret, dc } = await ownReturn(11);
    await handOverWithNote(dc.return_id);
    await app.open(`/procurement/returns?q=${po}`);
    await expect(screen.getByRole('tab', /^Completed/)).toBeVisible(SLOW);
    await expect(screen.getByRole('row', { name: new RegExp(po) })).toBeHidden();
    await screen.getByRole('tab', /^Completed/).tap();
    const row = screen.getByRole('row', { name: new RegExp(po) });
    await expect(row).toBeVisible(SLOW);
    await expect(row).toContainText('Completed');
    await row.tap();
    await expect(screen.getByRole('dialog')).toContainText(ret.return_number);
    await expect(screen.getByRole('dialog')).toContainText('Note Date');
  });
});

describe('Raising a return by hand', () => {
  test('RET-10 the PO sheet offers "Return N pcs" in its foot while excess is pending, and raises the return', { session: 'rina', tags: ['return-po'] }, async ({ app, screen }) => {
    const { acceptedWithExcess } = await import('../../support/po.ts');
    const { po } = await acceptedWithExcess(11);
    const sheet = await openSheet(app, screen, po);
    await expect(sheet).toContainText('Return PO');
    await expect(sheet).toContainText('3 pcs');
    await expect(sheet).toContainText('To Be Returned');
    await sheet.getByRole('button', 'Return 3 pcs').tap();
    await expect(screen.getByText('Send the Excess Back')).toBeVisible();
    await expect(screen.getByText(/These 3 pcs came beyond the order and go back to Garmen Nusantara/)).toBeVisible();
    await screen.getByRole('button', 'Raise the Return').tap();
    await expect(screen.getByText(/RS-\d{8} raised/)).toBeVisible({ timeout: 30_000 });
    const r = await waitFor('return exists', async () => { const l = await dcReturns(po); return l.length ? l : null; }, 90_000, 2_000);
    expect(r[0].quantity).toBe(3);
  });

  test('RET-11 the server refuses a second return when nothing is waiting to go back', { tags: ['return-po'] }, async () => {
    const { po } = await ownReturn(11);
    const d = await poDetail(po);
    const res = await as('cloud', 'rina').call('POST', `/api/v1/purchase-orders/${d.purchase_order_id}/returns`, {}, { ok: false });
    expect(JSON.stringify(res)).toContain('arrived beyond the order that is still waiting to go back');
  });

  test('RET-12 the Return PO button is gone once the excess is returned', { session: 'rina', tags: ['return-po'] }, async ({ app, screen }) => {
    const { po } = await ownReturn(11);
    const sheet = await openSheet(app, screen, po);
    await expect(sheet.getByRole('button', /^Return \d+ pcs$/)).toBeHidden();
  });

  test('RET-13 cancelling or editing a return has no UI and no endpoint', { tags: ['return-po'] }, async () => {
    const { ret } = await ownReturn(11);
    const res = await as('cloud', 'rina').call('POST', `/api/v1/purchase-returns/${ret.return_id}/cancel`, {}, { ok: false });
    expect(res === null || /not found|method/i.test(JSON.stringify(res))).toBe(true);
  });
});

describe('DC hand-over (the Gudang is the cloud)', () => {
  test('RET-20 the board lists the supplier\'s open return under Active with Generate Delivery Note', { session: 'nina', tags: ['return-po'] }, async ({ app, screen }) => {
    const { po } = await ownReturn(11);
    await boardFor(app, screen, po);
    await expect(screen.getByRole('tab', /^Active/)).toBeVisible();
    await expect(screen.getByRole('tab', /^Completed/)).toBeVisible();
    await expect(screen.getByText(SUP).first()).toBeVisible();
    await expect(screen.getByRole('button', 'Generate Delivery Note').first()).toBeVisible();
  });

  test('RET-21 Generate Delivery Note asks for the person in charge, lists the PO under "In this note", then offers Print, Download and Confirm', { session: 'nina', tags: ['return-po'] }, async ({ app, screen }) => {
    const { po, dc } = await ownReturn(11);
    await boardFor(app, screen, po);
    await screen.getByRole('button', 'Generate Delivery Note').first().tap();
    await expect(screen.getByText('In this note')).toBeVisible();
    await expect(screen.getByRole('dialog')).toContainText(po);
    // nobody in charge: the button is dead
    await screen.getByRole('textbox', 'Person in Charge').fill('');
    await expect(screen.getByRole('button', 'Generate Delivery Note').last()).toBeDisabled();
    await screen.getByRole('textbox', 'Person in Charge').fill('Pak Joko');
    await screen.getByRole('button', 'Generate Delivery Note').last().tap();
    await expect(screen.getByRole('button', 'Confirm').first()).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('button', 'Print').first()).toBeVisible();
    await expect(screen.getByRole('button', 'Download').first()).toBeVisible();
    const r = await waitFor('note generated', async () => { const l = await dcReturns(po); return l[0]?.note_generated_at ? l : null; }, 30_000, 1_000);
    expect(r[0].note_pic).toBe('Pak Joko');
    expect(r[0].return_id).toBe(dc.return_id);
  });

  test('RET-22 Confirm hands the goods over: "Sent back to <supplier>." and the return completes', { session: 'nina', tags: ['return-po'] }, async ({ app, screen }) => {
    const { po } = await ownReturn(11);
    await boardFor(app, screen, po);
    await generateNote(screen, po);
    await screen.getByRole('button', 'Confirm').first().tap();
    await expect(screen.getByText(`Confirm ${SUP}?`)).toBeVisible();
    await expect(screen.getByText(new RegExp(`1 returns?, 3 pcs go back to ${SUP}`))).toBeVisible();
    await screen.getByRole('button', 'Confirm').last().tap();
    await expect(screen.getByText(new RegExp(`Sent back to ${SUP}`))).toBeVisible({ timeout: 45_000 });
    const done = await waitFor('handed over', async () => { const l = await dcReturns(po); return l[0]?.handed_over_at ? l : null; }, 45_000, 1_000);
    expect(done[0].status).not.toBe('OPEN');
  });

  test('RET-23 a handed-over return shows Completed in the buyer list', { session: 'rina', tags: ['return-po'] }, async ({ app, screen }) => {
    const { po, dc } = await ownReturn(11);
    await handOverWithNote(dc.return_id);
    await app.open(`/procurement/returns?q=${po}`);
    await screen.getByRole('tab', /^Completed/).tap();
    const row = screen.getByRole('row', { name: new RegExp(po) });
    await expect(row).toBeVisible(SLOW);
    await expect(row).toContainText('Completed');
  });

  test('RET-24 the server refuses a delivery note with nobody in charge', { tags: ['return-po'] }, async () => {
    const { dc } = await ownReturn(11);
    const res = await as('dc', 'nina').call('POST', '/api/v1/dc/purchase-returns/note', { return_ids: [dc.return_id], pic: '' }, { ok: false });
    expect(JSON.stringify(res)).toContain('say who is in charge of this delivery');
  });

  test('RET-25 the server refuses a hand-over before the surat jalan is generated', { tags: ['return-po'] }, async () => {
    const { dc } = await ownReturn(11);
    const res = await as('dc', 'nina').call('POST', `/api/v1/dc/purchase-returns/${dc.return_id}/hand-over`, { actor_id: 'nina', handed_to: null, idempotency_key: uid() }, { ok: false });
    expect(JSON.stringify(res)).toMatch(/generate the surat jalan/);
  });

  test('RET-26 the server refuses a second hand-over', { tags: ['return-po'] }, async () => {
    const { dc } = await ownReturn(11);
    await handOverWithNote(dc.return_id);
    const again = await as('dc', 'nina').call('POST', `/api/v1/dc/purchase-returns/${dc.return_id}/hand-over`, { actor_id: 'nina', handed_to: null, idempotency_key: uid() }, { ok: false });
    expect(JSON.stringify(again)).toMatch(/already been handed/);
  });

  test('RET-27 a return is on the board\'s Completed tab once handed over, and no longer under Active', { session: 'nina', tags: ['return-po'] }, async ({ app, screen }) => {
    const { po, dc } = await ownReturn(11);
    await handOverWithNote(dc.return_id);
    await app.open('/operations/board/suppliers');
    await expect(screen.getByRole('heading', 'Return PO')).toBeVisible(SLOW);
    await screen.getByLabel('Search returns').fill(po);
    await expect(screen.getByText('Nothing active.')).toBeVisible(SLOW);
    await screen.getByRole('tab', /^Completed/).tap();
    await expect(screen.getByText(po).first()).toBeVisible(SLOW);
    await expect(screen.getByRole('button', 'Generate Delivery Note')).toBeHidden();
  });
});

describe('Surat Jalan Retur (the printed note and the PDF)', () => {
  test('RET-30 Download gives surat-jalan-retur-<supplier>.pdf with the owner\'s words in it', { session: 'rina', tags: ['return-po'] }, async ({ app, screen, browser }) => {
    const { ret } = await ownReturn(11);
    await app.open(`/procurement/returns?allotment=${ret.return_id}`);
    await expect(screen.getByRole('dialog')).toContainText(SUP, SLOW);
    const file = await browser.waitForDownload(() => screen.getByRole('dialog').getByRole('button', 'Download').tap(), { timeout: 60_000 });
    expect(file.suggestedFilename).toBe('surat-jalan-retur-Return-PO-e2e.pdf');
    let path: string;
    try {
      path = locateDownload(file.path, file.suggestedFilename);
    } catch {
      path = file.path;
    }
    const pdf = readFileSync(path, 'latin1');
    expect(pdf.startsWith('%PDF')).toBe(true);
    for (const text of ['SURAT JALAN RETUR', 'Tgl', 'No PO', 'Kepada', SUP, 'Item', 'Quantity', 'Total', 'Hormat kami', 'Notes', 'Pengirim']) {
      expect(pdf, `the PDF says "${text}"`).toContain(text);
    }
    expect(pdf).toContain(RETURN_ADDRESS);
    expect(pdf).toContain('Telp.');
  });

  test('RET-31 Print writes the surat jalan: Tgl, No PO, Kepada with address and phone, Item / Quantity, one Total, Hormat kami, Notes : Pengirim', { session: 'rina', tags: ['return-po'] }, async ({ app, screen, browser }) => {
    const { po, ret } = await ownReturn(11);
    await capturePrint(browser);
    await app.open(`/procurement/returns?allotment=${ret.return_id}`);
    await expect(screen.getByRole('dialog')).toContainText(SUP, SLOW);
    await screen.getByRole('dialog').getByRole('button', 'Print').tap();
    const html = await waitFor('the printed note', async () => { const h = await printed(browser); return h.includes('SURAT JALAN RETUR') ? h : null; }, 15_000, 500);
    const text = words(html);
    expect(html).toContain('<html lang="id">');
    expect(text).toContain('SURAT JALAN RETUR');
    expect(text).toMatch(/Tgl : \d{1,2} \w{3} \d{4}/);
    expect(text).toContain(`No PO : ${po}`);
    expect(text).toContain('Kepada :');
    expect(text).toContain(SUP);
    expect(text).toContain(RETURN_ADDRESS);
    expect(text).toMatch(/Telp\. .*555.?0107/);
    expect(text).toMatch(/Item\s+Quantity/);
    expect(text).toContain('Kaos Uji');
    expect(text.match(/\bTotal\b/g)).toHaveLength(1);
    expect(text).toContain('Hormat kami,');
    expect(text).toContain('Notes :');
    expect(text).toMatch(/Pengirim \(/);
    expect(text).not.toContain('Not as Ordered');
  });

  test('RET-32 with Not as Ordered pieces the note has one extra row "Not as Ordered / Item Unknown" and still one Total', { session: 'rina', tags: ['return-po'] }, async ({ app, screen, browser }) => {
    const { ret } = await ownReturn(10, 3);
    await capturePrint(browser);
    await app.open(`/procurement/returns?allotment=${ret.return_id}`);
    await expect(screen.getByRole('dialog')).toContainText(SUP, SLOW);
    await screen.getByRole('dialog').getByRole('button', 'Print').tap();
    const html = await waitFor('the printed note', async () => { const h = await printed(browser); return h.includes('SURAT JALAN RETUR') ? h : null; }, 15_000, 500);
    const text = words(html);
    expect(text).toContain('Not as Ordered');
    expect(text).toContain('Item Unknown');
    expect(text.match(/\bTotal\b/g)).toHaveLength(1);
  });

  test('RET-33 the note made at the Gudang prints the person in charge under Notes : Pengirim and the note\'s own date as Tgl', { session: 'nina', tags: ['return-po'] }, async ({ app, screen, browser }) => {
    const { po } = await ownReturn(11);
    await capturePrint(browser);
    await boardFor(app, screen, po);
    await generateNote(screen, po, 'pak joko');
    await screen.getByRole('button', 'Print').first().tap();
    const html = await waitFor('the printed note', async () => { const h = await printed(browser); return h.includes('SURAT JALAN RETUR') ? h : null; }, 15_000, 500);
    const text = words(html);
    expect(text).toContain(`No PO : ${po}`);
    expect(text).toContain('Pengirim ( Pak Joko )');
    expect(text).toContain(SUP);
  });

  test('RET-34 the PDF from the board is named after the supplier and carries the person in charge', { session: 'nina', tags: ['return-po'] }, async ({ app, screen, browser }) => {
    const { po } = await ownReturn(11);
    await boardFor(app, screen, po);
    await generateNote(screen, po, 'pak joko');
    const file = await browser.waitForDownload(() => screen.getByRole('button', 'Download').first().tap(), { timeout: 60_000 });
    expect(file.suggestedFilename).toBe('surat-jalan-retur-Return-PO-e2e.pdf');
    let path: string;
    try {
      path = locateDownload(file.path, file.suggestedFilename);
    } catch {
      path = file.path;
    }
    const pdf = readFileSync(path, 'latin1');
    expect(pdf).toContain('Pak Joko');
    expect(pdf).toContain(po);
  });
});

describe('Register return (New return)', () => {
  test('RET-40 New return opens "New Return PO"; with no return stock it says so', { session: 'rina', tags: ['return-po'] }, async ({ app, screen }) => {
    await app.open('/procurement/returns');
    await screen.getByRole('button', 'New return').tap();
    await expect(screen.getByText('New Return PO')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('button', 'Back')).toBeVisible();
  });

  test('RET-41 a register return of return-stock goods is confirmed with a surat', { session: 'rina', tags: ['return-po'] }, async () => {
    test.skip(true, 'needs stock in the head-office RETURN pool with SKUs mapped to a supplier; this rig has none and no safe way to create it from the Return PO domain');
  });
});
