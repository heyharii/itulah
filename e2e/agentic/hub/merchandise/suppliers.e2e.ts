// Procurement › Suppliers (screens/procurement/suppliers.tsx; the same screen answers /master/suppliers) and GA › Suppliers (screens/vendors).
// Supplier 0001 (Garmen Nusantara) is read, never changed; every record a test edits is a supplier of this run.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { createSupplierApi, cloudCall, openList, SLOW, supplierByName, supplierDetail, tag } from '../../support/merchandise.ts';

const TAGS = ['merchandise', 'suppliers'];
const rowOf = (screen: any, text: string) => screen.getByRole('row').filter({ hasText: text });
const NAME = 'Garmen Nusantara, PT';

/** Open a supplier's sheet from the list search. */
async function openSupplier(app: any, screen: any, name: string, path = '/procurement/suppliers') {
  await openList(app, screen, path, 'Suppliers');
  await screen.getByRole('textbox', 'Search supplier name').fill(name);
  await rowOf(screen, name).first().tap();
  await expect(screen.getByRole('dialog').getByRole('button', 'Edit')).toBeVisible(SLOW);
}

describe('Suppliers list', { tags: TAGS }, () => {
  test('MER-110 the supplier book reads Garmen Nusantara with its code, status and order counts', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await openList(app, screen, '/procurement/suppliers', 'Suppliers');
    await expect(rowOf(screen, NAME)).toContainText('0001', SLOW);
    await expect(rowOf(screen, NAME)).toContainText('Active');
    for (const kpi of ['Active', 'Non-active', 'Active PO', 'Active PO qty', 'Active PO value']) {
      await expect(screen.getByText(kpi, { exact: true }).first()).toBeVisible();
    }
  });

  test('MER-111 the tabs count suppliers by status', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/procurement/suppliers', 'Suppliers');
    const page = (await cloudCall('GET', '/api/v1/suppliers?limit=200&category=MERCHANDISE')).body;
    const active = (page.rows as any[]).filter((s) => s.status === 'ACTIVE').length;
    await expect(screen.getByRole('tab', new RegExp(`^Active\\s*${active}$`))).toBeVisible(SLOW);
    await expect(screen.getByRole('tab', /^Non-active/)).toBeVisible();
    await expect(screen.getByRole('tab', /^All/)).toBeVisible();
  });

  test('MER-112 search by name narrows the book', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/procurement/suppliers', 'Suppliers');
    await screen.getByRole('textbox', 'Search supplier name').fill('Nusantara');
    await expect(rowOf(screen, NAME)).toBeVisible(SLOW);
    await expect(rowOf(screen, 'Sepatu Sejahtera')).toBeHidden();
    await screen.getByRole('textbox', 'Search supplier name').fill('zzz-tidak-ada');
    await expect(screen.getByText('No supplier matches what you asked for.')).toBeVisible(SLOW);
  });

  test('MER-113 "Only suppliers with an active order" drops suppliers with none', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const t = tag('K');
    const quiet = await createSupplierApi(`Uji Sepi ${t}`);
    await openList(app, screen, '/procurement/suppliers', 'Suppliers');
    await screen.getByRole('textbox', 'Search supplier name').fill('Uji Sepi');
    await expect(rowOf(screen, `Uji Sepi ${t}`)).toBeVisible(SLOW);
    await screen.getByRole('switch', 'Only suppliers with an active order').tap();
    await expect(rowOf(screen, `Uji Sepi ${t}`)).toBeHidden(SLOW);
    expect(quiet.supplier_id).toBeTruthy();
  });

  test('MER-114 Export CSV is offered on the book', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/procurement/suppliers', 'Suppliers');
    await expect(screen.getByRole('button', 'Export CSV')).toBeVisible(SLOW);
  });

  test('MER-115 the same book opens under Master › Suppliers', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/master/suppliers', 'Suppliers');
    await expect(rowOf(screen, NAME)).toContainText('0001', SLOW);
  });

  test('MER-116 the Master menu lists Suppliers beside Articles', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await app.open('/master');
    const nav = screen.getByRole('navigation', 'Master');
    for (const label of ['Articles', 'New Articles', 'Divisions', 'Tags', 'Sizes', 'Colors', 'Name Suggestions', 'Suppliers']) {
      await expect(nav.getByRole('link', new RegExp(`^${label}`))).toBeVisible(SLOW);
    }
  });
});

describe('Suppliers: create and edit', { tags: TAGS }, () => {
  test('MER-120 Create supplier with nothing filled names each gap and creates nothing', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/procurement/suppliers', 'Suppliers');
    const before = (await cloudCall('GET', '/api/v1/suppliers?limit=1')).body.total;
    await screen.getByRole('button', 'New supplier').tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('button', 'Create supplier').tap();
    for (const msg of ["Fill in the supplier's name.", 'Choose the legal form.', 'Fill in the address.', 'Fill in a phone number.']) {
      await expect(sheet.getByText(msg)).toBeVisible();
    }
    expect((await cloudCall('GET', '/api/v1/suppliers?limit=1')).body.total).toBe(before);
  });

  test('MER-121 phone, email and NPWP are checked for shape', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/procurement/suppliers', 'Suppliers');
    await screen.getByRole('button', 'New supplier').tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', 'Phone Number').fill('123');
    await sheet.getByRole('textbox', 'Phone Number').press('Tab');
    await expect(sheet.getByText('That is too short for a phone number.')).toBeVisible();
    await sheet.getByRole('textbox', { name: /^Email/ }).fill('bukan-email');
    await sheet.getByRole('textbox', { name: /^Email/ }).press('Tab');
    await expect(sheet.getByText('An email address carries one @, with a name and a domain around it.')).toBeVisible();
    await sheet.getByRole('textbox', { name: /^NPWP/ }).fill('12345');
    await sheet.getByRole('textbox', { name: /^NPWP/ }).press('Tab');
    await expect(sheet.getByText('An NPWP has 16 digits — an old 15-digit one gets a 0 in front.')).toBeVisible();
  });

  test('MER-122 a contact needs a name and a phone or an email', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/procurement/suppliers', 'Suppliers');
    await screen.getByRole('button', 'New supplier').tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', 'Contact 1 role').fill('Sales');
    await expect(sheet.getByText('Give this contact a name.')).toBeVisible();
    await sheet.getByRole('textbox', 'Contact 1 name').fill('Budi Uji');
    await expect(sheet.getByText('A contact needs a phone number or an email.')).toBeVisible();
  });

  test('MER-123 a supplier created in the sheet gets the next code and keeps its contact', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const t = tag('S');
    const name = `Uji Baru ${t}`;
    await openList(app, screen, '/procurement/suppliers', 'Suppliers');
    await screen.getByRole('button', 'New supplier').tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', { name: /^Name/ }).fill(name);
    await sheet.getByRole('combobox', 'Legal Form').tap();
    await screen.getByRole('option', 'CV').tap();
    await sheet.getByRole('textbox', { name: /^Address/ }).fill('Jl. Contoh No. 5, Bandung');
    await sheet.getByRole('textbox', 'Phone Number').fill('0812 3456 7890');
    await sheet.getByRole('textbox', { name: /^Email/ }).fill('uji@contoh.co.id');
    await sheet.getByRole('textbox', 'Contact 1 name').fill('Ibu Uji');
    await sheet.getByRole('textbox', 'Contact 1 phone').fill('0813 1111 2222');
    await sheet.getByRole('button', 'Create supplier').tap();
    await expect(screen.getByText(/\d{4} saved/)).toBeVisible({ timeout: 60_000 });
    const made = await supplierByName(name);
    expect(made, 'supplier created').toBeDefined();
    expect(made.legal_form).toBe('CV');
    expect(made.category).toBe('MERCHANDISE');
    expect(made.status).toBe('ACTIVE');
    expect(made.supplier_code).toMatch(/^\d{4}$/);
    expect(made.email).toBe('uji@contoh.co.id');
    const people = (await cloudCall('GET', `/api/v1/suppliers/${made.supplier_id}/contacts`)).body;
    expect((people as any[]).map((c) => c.name)).toContain('Ibu Uji');
  });

  test('MER-124 the sheet reads Details, Orders and Catalogue tabs and a Print/Edit footer', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openSupplier(app, screen, NAME);
    const sheet = screen.getByRole('dialog');
    for (const tab of ['Details', 'Orders', 'Catalogue']) await expect(sheet.getByRole('tab', tab)).toBeVisible();
    await expect(sheet).toContainText('0001');
    await expect(sheet).toContainText('Garmen Nusantara');
    await expect(sheet).toContainText('Jl. Industri No. 12, Bandung');
    await expect(sheet).toContainText('Contact person');
    await expect(sheet).toContainText('0812 1000 0001');
    await expect(sheet).toContainText('sales@garmennusantara.co.id');
    await expect(sheet.getByRole('button', 'Print')).toBeVisible();
  });

  test('MER-125 Edit changes the address and says Changes saved', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const t = tag('E');
    const made = await createSupplierApi(`Uji Ubah ${t}`);
    await openSupplier(app, screen, `Uji Ubah ${t}`);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('button', 'Edit').tap();
    await sheet.getByRole('textbox', { name: /^Address/ }).fill('Jl. Pindah No. 9, Cimahi');
    await sheet.getByRole('button', 'Save changes').tap();
    await expect(screen.getByText('Changes saved')).toBeVisible(SLOW);
    expect((await supplierDetail(made.supplier_id)).address).toBe('Jl. Pindah No. 9, Cimahi');
  });

  test('MER-126 Save changes stays disabled and says why when a required box is emptied', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const t = tag('F');
    await createSupplierApi(`Uji Kosong ${t}`);
    await openSupplier(app, screen, `Uji Kosong ${t}`);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('button', 'Edit').tap();
    await sheet.getByRole('textbox', { name: /^Address/ }).fill('');
    await expect(sheet.getByRole('button', 'Save changes')).toBeDisabled();
    await expect(sheet.getByText('A name, legal form, address and phone number are needed.')).toBeVisible();
  });

  test('MER-127 making a supplier non-active asks first, and it can be made active again', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const t = tag('N');
    const made = await createSupplierApi(`Uji Mati ${t}`);
    await openSupplier(app, screen, `Uji Mati ${t}`);
    const sheet = screen.getByRole('dialog', new RegExp(`Uji Mati ${t}`));
    await sheet.getByRole('button', 'Edit').tap();
    await sheet.getByRole('switch', 'Active').tap();
    await expect(screen.getByText('Make This Supplier Non-Active?')).toBeVisible();
    await expect(screen.getByText('A non-active supplier cannot be used to create a purchase order.')).toBeVisible();
    await screen.getByRole('button', 'Continue').tap();
    await expect(sheet).toContainText('No purchase order can be issued to this supplier.', SLOW);
    expect((await supplierDetail(made.supplier_id)).status).toBe('INACTIVE');
    await sheet.getByRole('switch', 'Active').tap();
    await expect(sheet).toContainText('Purchase orders can be issued to this supplier.', SLOW);
    expect((await supplierDetail(made.supplier_id)).status).toBe('ACTIVE');
  });

  test('MER-128 a supplier with no orders reads None under Orders and an empty Catalogue', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const t = tag('O');
    await createSupplierApi(`Uji Pesanan ${t}`);
    await openSupplier(app, screen, `Uji Pesanan ${t}`);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('tab', 'Orders').tap();
    await expect(sheet).toContainText('Active Order');
    await expect(sheet).toContainText('None.');
    await sheet.getByRole('tab', 'Catalogue').tap();
    await expect(sheet).toContainText('This supplier offers nothing yet, so no order can name them.', SLOW);
  });

  test('MER-129 Garmen Nusantara\'s Orders tab groups its purchase orders by state', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openSupplier(app, screen, NAME);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('tab', 'Orders').tap();
    for (const title of ['Active Order', 'Completed Order', 'Cancelled Order']) await expect(sheet).toContainText(title, SLOW);
  });

  test('MER-130 Add item on the Catalogue tab checks name, division, tags and price', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const t = tag('I');
    await createSupplierApi(`Uji Item ${t}`);
    await openSupplier(app, screen, `Uji Item ${t}`);
    await screen.getByRole('dialog').getByRole('tab', 'Catalogue').tap();
    await screen.getByRole('dialog').getByRole('button', 'Add item').tap();
    await screen.getByRole('button', 'Submit').last().tap();
    for (const msg of ['Give it a name.', 'Choose a division.', 'Choose at least one tag.', 'Fill in the price.']) {
      await expect(screen.getByText(msg)).toBeVisible();
    }
  });
});

describe('Suppliers: duplicates', { tags: TAGS }, () => {
  test('MER-131 a second supplier with the same name and legal form is refused — BUG: the server accepts it', { session: 'rina', tags: [...TAGS, 'bug', 'api'] }, async () => {
    const name = `Uji Kembar ${tag('D')}`;
    const first = await createSupplierApi(name);
    expect(first.supplier_id).toBeTruthy();
    const second = await cloudCall('POST', '/api/v1/suppliers', {
      supplier_code: null, name, legal_form: 'PT', phone: '0812-3456-7890', address: 'Jl. Uji No. 1', status: 'ACTIVE', is_pkp: false, contacts: [],
    });
    expect(second.status, 'two suppliers may not share a name').toBeGreaterThanOrEqual(400);
  });
});

describe('GA › Suppliers (operating and affiliate)', { tags: TAGS }, () => {
  test('MER-140 GA Suppliers opens on the Operating book and never lists a garment supplier', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/vendors', 'Suppliers');
    await expect(screen.getByRole('button', 'Operating')).toBeVisible();
    await expect(screen.getByRole('button', 'Affiliate')).toBeVisible();
    await expect(screen.getByText('Garmen Nusantara', { exact: false })).toHaveCount(0);
  });

  test('MER-141 Add supplier needs a code and a name; an operating supplier is created Active', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const t = tag('V');
    await openList(app, screen, '/vendors', 'Suppliers');
    await screen.getByRole('button', 'Add supplier').first().tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('button', 'Submit')).toBeDisabled();
    await sheet.getByRole('textbox', { name: /^Code/ }).fill(`G${t}`);
    await sheet.getByRole('textbox', { name: /^Name/ }).fill(`Uji Listrik ${t}`);
    await expect(sheet.getByRole('button', 'Submit')).toBeEnabled();
    await sheet.getByRole('button', 'Submit').tap();
    await expect(sheet).toBeHidden(SLOW);
    const made = await supplierByName(`Uji Listrik ${t}`);
    expect(made?.category).toBe('EXPENSE');
    expect(made?.status).toBe('ACTIVE');
  });

  test('MER-142 an operating supplier can be deactivated and reactivated from its sheet', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const t = tag('W');
    const made = await createSupplierApi(`Uji Air ${t}`, { category: 'EXPENSE', legal_form: null });
    await openList(app, screen, '/vendors', 'Suppliers');
    await screen.getByRole('textbox').first().fill(`Uji Air ${t}`);
    await screen.getByText(`Uji Air ${t}`, { exact: false }).first().tap();
    await screen.getByRole('dialog').getByRole('button', 'Deactivate').tap();
    await expect(screen.getByRole('dialog')).toBeHidden(SLOW);
    expect((await supplierDetail(made.supplier_id)).status).toBe('INACTIVE');
  });
});
