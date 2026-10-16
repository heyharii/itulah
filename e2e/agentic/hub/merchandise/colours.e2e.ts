// Master › Colors (screens/master/colours.tsx): the colour master with hex, swatch, twin warning and usage rules.
// BLACK / WHITE are seeded and relied on by other suites; this file only creates and removes its own colours.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { colourByLabel, colours, createColourApi, deleteColourApi, openList, SLOW, tag } from '../../support/merchandise.ts';

const TAGS = ['merchandise', 'colours'];
const rowOf = (screen: any, text: string) => screen.getByRole('row').filter({ hasText: text });
const codeOf = (label: string) => label.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
// The Hex box has no accessible name (see MER-39), so it is the last textbox of the sheet (Label, [Code], Hex).
const hexBox = (sheet: any) => sheet.getByRole('textbox').last();

async function openColour(screen: any, label: string) {
  await screen.getByRole('textbox', 'Search Colors').fill(label);
  await screen.getByRole('button', `Edit ${label}`).tap();
  await expect(screen.getByRole('dialog').getByRole('button', 'Save')).toBeVisible(SLOW);
}

describe('Master colours', { tags: TAGS }, () => {
  test('MER-30 Colors lists the master with its code and how many SKUs use each', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await openList(app, screen, '/master/colours', 'Colors');
    await expect(screen.getByRole('row', { name: /^Black BLACK/ })).toContainText(/SKUs?/, SLOW);
    await expect(screen.getByRole('row', { name: /^White WHITE/ })).toContainText(/SKUs?/);
    const all = await colours();
    await expect(screen.getByRole('tab', new RegExp(`^All\\s*${all.length}$`))).toBeVisible();
  });

  test('MER-31 New Color keeps the hex that was typed and mints the code from the label', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const label = `Uji ${tag('C')}`;
    await openList(app, screen, '/master/colours', 'Colors');
    try {
      await screen.getByRole('button', 'New Color').first().tap();
      const sheet = screen.getByRole('dialog');
      await sheet.getByRole('textbox', { name: /^Label/ }).fill(label);
      await hexBox(sheet).fill('#1B2A4A');
      await hexBox(sheet).press('Tab');
      await expect(hexBox(sheet)).toHaveValue('#1B2A4A');
      await sheet.getByRole('button', 'Add Color').tap();
      await expect(sheet).toBeHidden(SLOW);
      const made = await colourByLabel(label);
      expect(made?.code).toBe(codeOf(label));
      expect(made?.hex_code).toBe('#1B2A4A');
      expect(made?.in_use).toBe(0);
      await screen.getByRole('textbox', 'Search Colors').fill(label);
      await expect(rowOf(screen, label)).toContainText('0 SKUs', SLOW);
    } finally {
      await deleteColourApi(codeOf(label));
    }
  });

  test('MER-32 a hex that is not six digits after a hash is refused with the example', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/master/colours', 'Colors');
    await screen.getByRole('button', 'New Color').first().tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', { name: /^Label/ }).fill(`Uji ${tag('H')}`);
    await hexBox(sheet).fill('#12');
    await hexBox(sheet).press('Tab');
    await sheet.getByRole('button', 'Add Color').tap();
    await expect(screen.getByText('Six hex digits after a hash — #1B2A4A.')).toBeVisible();
    await expect(sheet).toBeVisible();
  });

  test('MER-33 a label another color already has names that color', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/master/colours', 'Colors');
    await screen.getByRole('button', 'New Color').first().tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', { name: /^Label/ }).fill('black');
    await sheet.getByRole('button', 'Add Color').tap();
    await expect(screen.getByText('BLACK already reads as “Black”.', { exact: false })).toBeVisible();
    await expect(sheet).toBeVisible();
  });

  test('MER-34 a hex a person cannot tell from an existing color shows that color as a caution, not a refusal', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/master/colours', 'Colors');
    await screen.getByRole('button', 'New Color').first().tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', { name: /^Label/ }).fill(`Uji ${tag('W')}`);
    await hexBox(sheet).fill('#111111');
    await hexBox(sheet).press('Tab');
    await expect(screen.getByText('Reads the same as this at a glance.', { exact: false })).toBeVisible();
    await expect(sheet.getByRole('button', 'Add Color')).toBeEnabled();
  });

  test('MER-35 editing a color changes its hex and label while the code stays', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const label = `Uji ${tag('E')}`;
    const made = await createColourApi(label, '#336699');
    try {
      await openList(app, screen, '/master/colours', 'Colors');
      await openColour(screen, label);
      const sheet = screen.getByRole('dialog');
      await expect(sheet.getByRole('textbox', { name: 'Code' })).toHaveValue(made.code);
      await hexBox(sheet).fill('#AA5500');
      await hexBox(sheet).press('Tab');
      await sheet.getByRole('textbox', { name: /^Label/ }).fill(`${label} baru`);
      await sheet.getByRole('button', 'Save').tap();
      await expect(sheet).toBeHidden(SLOW);
      const after = (await colours()).find((c) => c.code === made.code);
      expect(after?.hex_code).toBe('#AA5500');
      expect(after?.label).toBe(`${label} baru`);
    } finally {
      await deleteColourApi(made.code);
    }
  });

  test('MER-36 an unused color can be deleted; a color SKUs use has no Delete', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const label = `Uji ${tag('X')}`;
    const made = await createColourApi(label, '#445566');
    await openList(app, screen, '/master/colours', 'Colors');
    await openColour(screen, 'Black');
    await expect(screen.getByRole('dialog').getByRole('button', 'Save')).toBeVisible();
    await expect(screen.getByRole('dialog').getByRole('button', 'Delete')).toHaveCount(0);
    await app.open('/master/colours');
    await expect(screen.getByRole('heading', 'Colors')).toBeVisible(SLOW);
    await openColour(screen, label);
    await screen.getByRole('dialog').getByRole('button', 'Delete').tap();
    await expect(screen.getByText(`Delete ${label}?`)).toBeVisible();
    await expect(screen.getByText('Nothing uses this color. It is removed for good and cannot be brought back.')).toBeVisible(SLOW);
    await screen.getByRole('button', 'Delete').last().tap();
    await expect(screen.getByRole('dialog')).toBeHidden(SLOW);
    expect((await colours()).find((c) => c.code === made.code)).toBeUndefined();
  });

  test('MER-37 making a color inactive asks what uses it first', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const label = `Uji ${tag('Y')}`;
    const made = await createColourApi(label, '#778899');
    try {
      await openList(app, screen, '/master/colours', 'Colors');
      await openColour(screen, label);
      const sheet = screen.getByRole('dialog');
      await sheet.getByRole('switch', 'Active').tap();
      await expect(screen.getByText(`Make ${label} Inactive?`)).toBeVisible();
      await expect(screen.getByText('Nothing uses this color today.')).toBeVisible(SLOW);
      await screen.getByRole('button', 'Make Inactive').tap();
      await sheet.getByRole('button', 'Save').tap();
      await expect(sheet).toBeHidden(SLOW);
      expect((await colours()).find((c) => c.code === made.code)?.active).toBe(false);
    } finally {
      await deleteColourApi(made.code);
    }
  });

  test('MER-39 the Hex box is reachable by its label — BUG: it has no accessible name', { session: 'rina', tags: [...TAGS, 'bug'] }, async ({ app, screen }) => {
    await openList(app, screen, '/master/colours', 'Colors');
    await screen.getByRole('button', 'New Color').first().tap();
    await expect(screen.getByRole('dialog').getByRole('textbox', { name: /^Hex/ })).toBeVisible({ timeout: 8_000 });
  });

  test('MER-38 Colors also opens under Merchandise', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/merchandise/colours', 'Colors');
    await expect(screen.getByRole('row', { name: /^Black BLACK/ })).toBeVisible(SLOW);
  });
});
