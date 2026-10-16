// Master › Name Suggestions (screens/master/name-suggestions.tsx): the names New Articles offers while a name is typed.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { createNameApi, deleteNameApi, nameSuggestions, openList, SLOW, tag } from '../../support/merchandise.ts';

const TAGS = ['merchandise', 'names'];
const rowOf = (screen: any, text: string) => screen.getByRole('row').filter({ hasText: text });

describe('Master name suggestions', { tags: TAGS }, () => {
  test('MER-60 New Name adds a suggestion to the list', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const name = `Kaos Uji ${tag('N')}`;
    await openList(app, screen, '/master/name-suggestions', 'Name Suggestions');
    let id: string | undefined;
    try {
      await screen.getByRole('button', 'New Name').first().tap();
      const sheet = screen.getByRole('dialog');
      await expect(sheet.getByRole('button', 'Add Name')).toBeDisabled();
      await sheet.getByRole('textbox', { name: /^Name/ }).fill(name);
      await sheet.getByRole('button', 'Add Name').tap();
      await expect(sheet).toBeHidden(SLOW);
      const made = (await nameSuggestions()).find((n) => n.name === name);
      id = made?.suggestion_id;
      expect(made?.active).toBe(true);
      await expect(rowOf(screen, name)).toBeVisible(SLOW);
    } finally {
      if (id) await deleteNameApi(id);
    }
  });

  test('MER-61 a name already on the list is refused in any case', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const name = `Blus Uji ${tag('D')}`;
    const made = await createNameApi(name);
    try {
      await openList(app, screen, '/master/name-suggestions', 'Name Suggestions');
      await screen.getByRole('button', 'New Name').first().tap();
      const sheet = screen.getByRole('dialog');
      await sheet.getByRole('textbox', { name: /^Name/ }).fill(name.toLowerCase());
      await sheet.getByRole('textbox', { name: /^Name/ }).press('Tab');
      await expect(sheet.getByText('That name is already on the list.')).toBeVisible();
      await expect(sheet.getByRole('button', 'Add Name')).toBeDisabled();
    } finally {
      await deleteNameApi(made.suggestion_id);
    }
  });

  test('MER-62 editing a name renames it', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const name = `Rok Uji ${tag('E')}`;
    const made = await createNameApi(name);
    try {
      await openList(app, screen, '/master/name-suggestions', 'Name Suggestions');
      await screen.getByRole('textbox', 'Search Name Suggestions').fill(name);
      await screen.getByRole('button', `Edit ${name}`).tap();
      const sheet = screen.getByRole('dialog');
      await sheet.getByRole('textbox', { name: /^Name/ }).fill(`${name} baru`);
      await sheet.getByRole('button', 'Save').tap();
      await expect(sheet).toBeHidden(SLOW);
      expect((await nameSuggestions()).find((n) => n.suggestion_id === made.suggestion_id)?.name).toBe(`${name} baru`);
    } finally {
      await deleteNameApi(made.suggestion_id);
    }
  });

  test('MER-63 deleting a name stops it being suggested and touches no article', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const name = `Gaun Uji ${tag('X')}`;
    const made = await createNameApi(name);
    await openList(app, screen, '/master/name-suggestions', 'Name Suggestions');
    await screen.getByRole('textbox', 'Search Name Suggestions').fill(name);
    await screen.getByRole('button', `Edit ${name}`).tap();
    await screen.getByRole('dialog').getByRole('button', 'Delete').tap();
    await expect(screen.getByText(`Delete ${name}?`)).toBeVisible();
    await expect(screen.getByText('It stops being suggested in New Articles. No article is touched.')).toBeVisible();
    await screen.getByRole('button', 'Delete').last().tap();
    await expect(screen.getByRole('dialog')).toBeHidden(SLOW);
    expect((await nameSuggestions()).find((n) => n.suggestion_id === made.suggestion_id)).toBeUndefined();
  });

  test('MER-64 the search box narrows the list', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const a = `Celana Uji ${tag('A')}`;
    const b = `Jaket Uji ${tag('B')}`;
    const [ma, mb] = [await createNameApi(a), await createNameApi(b)];
    try {
      await openList(app, screen, '/master/name-suggestions', 'Name Suggestions');
      await screen.getByRole('textbox', 'Search Name Suggestions').fill(a);
      await expect(rowOf(screen, a)).toBeVisible(SLOW);
      await expect(rowOf(screen, b)).toBeHidden();
    } finally {
      await deleteNameApi(ma.suggestion_id);
      await deleteNameApi(mb.suggestion_id);
    }
  });
});
