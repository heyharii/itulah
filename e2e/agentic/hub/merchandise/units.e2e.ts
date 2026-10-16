// Master › Units & Conversions (screens/inventory/units.tsx, path /master/units; hidden from the menu, still routed).
// Global unit book following ERPNext: category, whole-number, aliases, conversions that chain to the main unit (PCS).
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { viewports } from '../../support/base.ts';
import {
  cloudCall, createConversionApi, createUnitApi, openList, SLOW, tag, unitCode, unitOf, unitsBook,
} from '../../support/merchandise.ts';

const TAGS = ['merchandise', 'units'];
const rowOf = (screen: any, text: string) => screen.getByRole('row').filter({ hasText: text });
const unique = (prefix: string) => `${prefix}${unitCode(tag('U'))}`.slice(0, 10);

/** A custom select: open it and pick the option by its text. */
async function pick(screen: any, trigger: any, option: string) {
  await trigger.tap();
  await screen.getByRole('option', option).tap();
}

async function openUnit(screen: any, code: string) {
  await rowOf(screen, code).first().tap();
  await expect(screen.getByRole('dialog').getByRole('button', 'Submit')).toBeVisible(SLOW);
}

describe('Master units', { tags: TAGS }, () => {
  test('MER-40 the unit book reads PCS as the main unit and LUSIN as 12 pcs with its conversion', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await openList(app, screen, '/master/units', 'Units & Conversions');
    await expect(rowOf(screen, 'PCS').first()).toContainText('Main unit', SLOW);
    await expect(rowOf(screen, 'LUSIN').first()).toContainText('12 pcs');
    await expect(rowOf(screen, 'KODI').first()).toContainText('20 pcs');
    await expect(rowOf(screen, 'GROSS').first()).toContainText('144 pcs');
    await expect(screen.getByText('1 lusin = 12 pcs')).toBeVisible();
    const lusin = await unitOf('LUSIN');
    expect(lusin?.pieces).toBe('12');
    expect(lusin?.whole_number).toBe(false); // a lusin is not countable in halves of a piece
  });

  test('MER-41 New unit lists what is missing and refuses a code that exists', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/master/units', 'Units & Conversions');
    await screen.getByRole('button', 'New unit').tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByText('A code is needed — PCS, LUSIN.')).toBeVisible();
    await expect(sheet.getByText('A unit needs a label.')).toBeVisible();
    await expect(sheet.getByRole('button', 'Submit')).toBeDisabled();
    await sheet.getByRole('textbox', { name: /^Code/ }).fill('pcs');
    await expect(sheet.getByText('PCS already exists.')).toBeVisible();
    await sheet.getByRole('textbox', { name: /^Code/ }).fill('bad code!');
    await expect(sheet.getByText('Letters, digits or _, at most 16.')).toBeVisible();
    await expect(sheet.getByRole('button', 'Submit')).toBeDisabled();
  });

  test('MER-42 New unit stores category, whole-number and aliases (lower case, comma separated)', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const code = unique('UJ');
    await openList(app, screen, '/master/units', 'Units & Conversions');
    await screen.getByRole('button', 'New unit').tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', { name: /^Code/ }).fill(code);
    await sheet.getByRole('textbox', { name: /^Label/ }).fill(`Uji ${code}`);
    await pick(screen, sheet.getByRole('combobox').first(), 'Weight');
    await sheet.getByRole('checkbox', { name: /^Whole numbers only/i }).uncheck();
    await sheet.getByRole('textbox', { name: /^Aliases/ }).fill(`Ujia ${code}, UJIB ${code}, ujia ${code}`);
    await sheet.getByRole('button', 'Submit').tap();
    await expect(sheet).toBeHidden(SLOW);
    const made = await unitOf(code);
    expect(made?.category).toBe('MASS');
    expect(made?.whole_number).toBe(false);
    expect(made?.is_base).toBe(false);
    expect([...(made?.aliases ?? [])].sort()).toEqual([`ujia ${code.toLowerCase()}`, `ujib ${code.toLowerCase()}`].sort());
    await expect(rowOf(screen, code).first()).toContainText('Weight');
  });

  test('MER-43 a conversion says how many main units one other unit is worth and shows it as it is typed', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const code = unique('CV');
    await createUnitApi(code, `Uji ${code}`);
    await openList(app, screen, '/master/units', 'Units & Conversions');
    await screen.getByRole('button', 'New conversion').tap();
    const sheet = screen.getByRole('dialog');
    await pick(screen, sheet.getByRole('combobox', 'Other unit'), code);
    await expect(sheet.getByRole('combobox', 'Main unit')).toContainText('PCS');
    await sheet.getByRole('textbox', { name: /^Conversion value/ }).fill('24');
    await expect(sheet.getByText(`1 ${code} = 24 PCS`)).toBeVisible();
    await sheet.getByRole('button', 'Submit').tap();
    await expect(sheet).toBeHidden(SLOW);
    expect((await unitOf(code))?.pieces).toBe('24');
    await expect(rowOf(screen, code).first()).toContainText('24 pcs', SLOW);
  });

  test('MER-44 conversion value rules: zero and more than four decimals are refused, letters are not typed', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/master/units', 'Units & Conversions');
    await screen.getByRole('button', 'New conversion').tap();
    const sheet = screen.getByRole('dialog');
    const value = sheet.getByRole('textbox', { name: /^Conversion value/ });
    await expect(sheet.getByText('A conversion value is needed.')).toBeVisible();
    await value.fill('0');
    await expect(sheet.getByText('Must be greater than zero.')).toBeVisible();
    await value.fill('abc'); // letters are not taken into a decimal box
    await expect(sheet.getByText('A conversion value is needed.')).toBeVisible();
    await value.fill('1.23456');
    await expect(sheet.getByText('A positive number, at most four decimal places.')).toBeVisible();
    await expect(sheet.getByRole('button', 'Submit')).toBeDisabled();
  });

  test('MER-45 a second conversion between the same two units is refused by name', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/master/units', 'Units & Conversions');
    await screen.getByRole('button', 'New conversion').tap();
    const sheet = screen.getByRole('dialog');
    await pick(screen, sheet.getByRole('combobox', 'Other unit'), 'LUSIN');
    await expect(sheet.getByText('A conversion between LUSIN and PCS already exists.')).toBeVisible();
    await expect(sheet.getByRole('button', 'Submit')).toBeDisabled();
  });

  test('MER-46 conversions chain: an A worth 2 B, a B worth 12 pcs, so an A is 24 pcs', { session: 'rina', tags: [...TAGS, 'api'] }, async () => {
    const a = unique('CA');
    const b = unique('CB');
    await createUnitApi(a, `Uji ${a}`);
    await createUnitApi(b, `Uji ${b}`);
    await createConversionApi(b, 'PCS', '12');
    await createConversionApi(a, b, '2');
    expect((await unitOf(b))?.pieces).toBe('12');
    expect((await unitOf(a))?.pieces).toBe('24');
    const { conversions } = await unitsBook();
    expect(conversions.some((c) => c.from_unit === a && c.to_unit === b && c.factor === '2')).toBe(true);
  });

  test('MER-47 the chained worth shows in the table', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const a = unique('CC');
    const b = unique('CD');
    await createUnitApi(a, `Uji ${a}`);
    await createUnitApi(b, `Uji ${b}`);
    await createConversionApi(b, 'PCS', '6');
    await createConversionApi(a, b, '3');
    await openList(app, screen, '/master/units', 'Units & Conversions');
    await expect(rowOf(screen, a).first()).toContainText('18 pcs', SLOW);
  });

  test('MER-48 a unit with a conversion has its category locked', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const code = unique('LK');
    await createUnitApi(code, `Uji ${code}`);
    await createConversionApi(code, 'PCS', '5');
    await openList(app, screen, '/master/units', 'Units & Conversions');
    await openUnit(screen, code);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByText('Fixed while a conversion joins this unit — those rows were written for this kind.')).toBeVisible();
    await expect(sheet.getByRole('combobox').first()).toBeDisabled();
    await expect(sheet.getByText('Worth 5 pcs')).toBeVisible();
  });

  test('MER-49 the main unit cannot be cancelled and a unit can be retired from its sheet', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const code = unique('RT');
    await createUnitApi(code, `Uji ${code}`);
    await openList(app, screen, '/master/units', 'Units & Conversions');
    await openUnit(screen, 'PCS');
    await expect(screen.getByRole('dialog').getByText('The main unit cannot be cancelled.')).toBeVisible();
    await expect(screen.getByRole('dialog').getByRole('checkbox', { name: /^Active/ })).toBeDisabled();
    await app.open('/master/units');
    await expect(screen.getByRole('heading', 'Units & Conversions')).toBeVisible(SLOW);
    await openUnit(screen, code);
    await screen.getByRole('dialog').getByRole('checkbox', { name: /^Active/ }).uncheck();
    await screen.getByRole('dialog').getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('dialog')).toBeHidden(SLOW);
    expect((await unitOf(code))?.active).toBe(false);
    await expect(rowOf(screen, code).first()).toContainText('Cancelled', SLOW);
  });

  test('MER-50 an alias another unit already answers to is refused by the server', { session: 'rina', tags: [...TAGS, 'api'] }, async () => {
    const code = unique('AL');
    const res = await cloudCall('POST', '/api/v1/units', { code, label: `Uji ${code}`, is_base: false, category: 'COUNT', whole_number: true, aliases: ['pcs'] });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("'pcs' already means");
    expect(await unitOf(code)).toBeUndefined();
  });

  test('MER-51 a unit of one category never converts to another (weight to pieces)', { session: 'rina', tags: [...TAGS, 'api'] }, async () => {
    const code = unique('WT');
    await createUnitApi(code, `Uji ${code}`, { category: 'MASS' });
    const res = await cloudCall('POST', '/api/v1/unit-conversions', { from_unit: code, to_unit: 'PCS', factor: '10', note: null });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toContain('different kinds of unit');
  });

  test('MER-52 the base unit cannot be cancelled through the API', { session: 'rina', tags: [...TAGS, 'api'] }, async () => {
    const pcs = await unitOf('PCS');
    const res = await cloudCall('PATCH', '/api/v1/units/PCS', { active: false }, { version: pcs!.version });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await unitOf('PCS'))?.active).toBe(true);
  });

  test('MER-53 Units & Conversions also opens under Merchandise (hidden row, working path)', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/merchandise/units', 'Units & Conversions');
    await expect(rowOf(screen, 'LUSIN').first()).toContainText('12 pcs', SLOW);
  });

  test('MER-54 on a phone the unit book is cards: label, code, worth, category', { session: 'rina', tags: TAGS }, async ({ app, screen, browser }) => {
    await browser.setViewport(viewports.phone);
    await openList(app, screen, '/master/units', 'Units & Conversions');
    await expect(screen.getByText('Piece', { exact: true }).first()).toBeVisible(SLOW);
    await expect(screen.getByText('Main unit', { exact: true }).first()).toBeVisible();
  });
});
