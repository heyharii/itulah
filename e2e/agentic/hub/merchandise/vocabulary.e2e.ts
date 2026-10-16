// Master › Divisions, Tags and Sizes: one screen written once (screens/master/vocabulary.tsx).
// Every term a test creates carries the run's tag() and is removed at the end; KAOS / PRIA / 03 / 04 are never touched.
import { describe, test } from '@e2e-dev/web';
import { expect, unique } from 'e2e';
import { viewports } from '../../support/base.ts';
import {
  articleDetail, cloudCall, createTermApi, deleteTermApi, openList, patchArticle, patchTermApi, sharedArticle, SLOW, tag, termByCode, termByLabel, terms, usage,
} from '../../support/merchandise.ts';

const TAGS = ['merchandise', 'vocabulary'];
const rowOf = (screen: any, text: string) => screen.getByRole('row').filter({ hasText: text });

/** Click New <Noun>, type the label and press Add <Noun> (the code is never asked for). */
async function addTerm(screen: any, noun: string, label: string) {
  await screen.getByRole('button', `New ${noun}`).first().tap();
  const sheet = screen.getByRole('dialog');
  await sheet.getByRole('textbox', { name: /^Label/ }).fill(label);
  await sheet.getByRole('button', `Add ${noun}`).tap();
  await expect(sheet).toBeHidden(SLOW);
}

/** Open a term's sheet from its row. */
async function openTerm(screen: any, label: string) {
  await screen.getByRole('textbox', /^Search/).fill(label);
  await screen.getByRole('button', `Edit ${label}`).tap();
  await expect(screen.getByRole('dialog').getByRole('button', 'Save')).toBeVisible(SLOW);
}

describe('Master vocabulary — Tags', { tags: TAGS }, () => {
  test('MER-10 Tags list reads KPIs and a seeded tag with how many articles use it', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await openList(app, screen, '/master/tags', 'Tags');
    for (const kpi of ['Total', 'Active', 'Inactive']) await expect(screen.getByText(kpi, { exact: true }).first()).toBeVisible();
    await expect(rowOf(screen, 'Kaos')).toContainText('KAOS', SLOW);
    await expect(rowOf(screen, 'Kaos')).toContainText(/Articles?/);
    // the tab labels carry the counts the API holds
    const all = await terms('tags');
    await expect(screen.getByRole('tab', new RegExp(`^All\\s*${all.length}$`))).toBeVisible();
  });

  test('MER-11 New Tag mints a tag whose code is its label in upper snake', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const label = `Uji ${tag('T')}`;
    await openList(app, screen, '/master/tags', 'Tags');
    try {
      await addTerm(screen, 'Tag', label);
      const made = await termByLabel('tags', label);
      expect(made?.code).toBe(label.toUpperCase().replace(/[^A-Z0-9]+/g, '_'));
      expect(made?.active).toBe(true);
      expect(made?.in_use).toBe(0);
      await screen.getByRole('textbox', /^Search/).fill(label);
      await expect(rowOf(screen, label)).toContainText(made!.code, SLOW);
      await expect(rowOf(screen, label)).toContainText('0 Articles');
    } finally {
      await deleteTermApi('tags', label.toUpperCase().replace(/[^A-Z0-9]+/g, '_'));
    }
  });

  test('MER-12 Add Tag with no label names the gap and keeps the sheet open', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/master/tags', 'Tags');
    const before = (await terms('tags')).length;
    await screen.getByRole('button', 'New Tag').first().tap();
    await screen.getByRole('dialog').getByRole('button', 'Add Tag').tap();
    await expect(screen.getByText('A term needs a name somebody can read on a picking list.')).toBeVisible();
    await expect(screen.getByRole('dialog')).toBeVisible();
    expect((await terms('tags')).length).toBe(before);
  });

  test('MER-13 a label another tag already has is refused as it is typed', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/master/tags', 'Tags');
    await screen.getByRole('button', 'New Tag').first().tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', { name: /^Label/ }).fill('kaos');
    await sheet.getByRole('button', 'Add Tag').tap();
    await expect(screen.getByText('Another term already reads that way.')).toBeVisible();
    expect((await terms('tags')).filter((t) => t.label.toLowerCase() === 'kaos').length).toBe(1);
  });

  test('MER-14 editing renames a tag and its code stays', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const label = `Uji ${tag('R')}`;
    const made = await createTermApi('tags', label);
    try {
      await openList(app, screen, '/master/tags', 'Tags');
      await openTerm(screen, label);
      const sheet = screen.getByRole('dialog');
      await expect(sheet.getByRole('textbox', { name: 'Code' })).toBeDisabled();
      await expect(sheet.getByRole('textbox', { name: 'Code' })).toHaveValue(made.code);
      await sheet.getByRole('textbox', { name: /^Label/ }).fill(`${label} baru`);
      await sheet.getByRole('button', 'Save').tap();
      await expect(sheet).toBeHidden(SLOW);
      const after = await termByCode('tags', made.code);
      expect(after?.label).toBe(`${label} baru`);
      expect(after?.version).toBeGreaterThan(made.version);
    } finally {
      await deleteTermApi('tags', made.code);
    }
  });

  test('MER-15 making a tag inactive asks what uses it, then moves it to the Inactive tab', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const label = `Uji ${tag('I')}`;
    const made = await createTermApi('tags', label);
    try {
      await openList(app, screen, '/master/tags', 'Tags');
      await openTerm(screen, label);
      const sheet = screen.getByRole('dialog');
      await sheet.getByRole('switch', 'Active').tap();
      await expect(screen.getByText(`Make ${label} Inactive?`)).toBeVisible();
      await expect(screen.getByText('Nothing uses this tag today.')).toBeVisible(SLOW);
      await expect(screen.getByText('It will not be used for new articles.', { exact: false })).toBeVisible();
      await screen.getByRole('button', 'Make Inactive').tap();
      await sheet.getByRole('button', 'Save').tap();
      await expect(sheet).toBeHidden(SLOW);
      expect((await termByCode('tags', made.code))?.active).toBe(false);
      // it left the Active tab (the default) and sits under Inactive
      await screen.getByRole('textbox', /^Search/).fill(label);
      await expect(rowOf(screen, label)).toBeHidden();
      await screen.getByRole('tab', /^Inactive/).tap();
      await expect(rowOf(screen, label)).toBeVisible(SLOW);
    } finally {
      await deleteTermApi('tags', made.code);
    }
  });

  test('MER-16 an unused tag can be deleted, for good', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const label = `Uji ${tag('D')}`;
    const made = await createTermApi('tags', label);
    await openList(app, screen, '/master/tags', 'Tags');
    await openTerm(screen, label);
    await screen.getByRole('dialog').getByRole('button', 'Delete').tap();
    await expect(screen.getByText(`Delete ${label}?`)).toBeVisible();
    await expect(screen.getByText('Nothing uses this tag. It is removed for good and cannot be brought back.')).toBeVisible(SLOW);
    await screen.getByRole('button', 'Delete').last().tap();
    await expect(screen.getByRole('dialog')).toBeHidden(SLOW);
    expect(await termByCode('tags', made.code)).toBeUndefined();
  });

  test('MER-17 a tag that articles carry has no Delete, only a read-only code', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/master/tags', 'Tags');
    await openTerm(screen, 'Kaos');
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('textbox', { name: 'Code' })).toHaveValue('KAOS');
    await expect(sheet.getByRole('button', 'Delete')).toHaveCount(0);
  });

  test('MER-18 the In Use switch keeps only tags something uses', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const label = `Uji ${tag('U')}`;
    const made = await createTermApi('tags', label);
    try {
      await openList(app, screen, '/master/tags', 'Tags');
      await expect(rowOf(screen, label)).toBeVisible(SLOW);
      await screen.getByRole('switch', 'In Use').tap();
      await expect(rowOf(screen, 'Kaos')).toBeVisible();
      await expect(rowOf(screen, label)).toBeHidden();
    } finally {
      await deleteTermApi('tags', made.code);
    }
  });

  test('MER-19 search narrows the tags by label or code', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/master/tags', 'Tags');
    await screen.getByRole('textbox', 'Search Tags').fill('KAUS_KAKI');
    await expect(rowOf(screen, 'Kaus Kaki')).toBeVisible(SLOW);
    await expect(rowOf(screen, 'Denim')).toBeHidden();
    await screen.getByRole('textbox', 'Search Tags').fill('zzzz-nothing');
    await expect(screen.getByText('Nothing matches that search.')).toBeVisible();
  });
});

describe('Master vocabulary — Divisions and Sizes', { tags: TAGS }, () => {
  test('MER-20 New Division is added after the others and the form has no Order box', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const label = `Uji ${tag('V')}`;
    await openList(app, screen, '/master/divisions', 'Divisions');
    const top = Math.max(...(await terms('divisions')).map((d) => d.display_order));
    try {
      await screen.getByRole('button', 'New Division').first().tap();
      await expect(screen.getByRole('dialog').getByRole('textbox', { name: /^Order/ })).toHaveCount(0);
      await screen.getByRole('dialog').getByRole('textbox', { name: /^Label/ }).fill(label);
      await screen.getByRole('dialog').getByRole('button', 'Add Division').tap();
      await expect(screen.getByRole('dialog')).toBeHidden(SLOW);
      const made = await termByLabel('divisions', label);
      expect(made?.display_order).toBe(top + 1);
    } finally {
      await deleteTermApi('divisions', label.toUpperCase().replace(/[^A-Z0-9]+/g, '_'));
    }
  });

  test('MER-21 a division the catalogue uses (PRIA) reads its article count and cannot be deleted', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    await openList(app, screen, '/master/divisions', 'Divisions');
    await expect(rowOf(screen, 'Pria')).toContainText(/Articles?/, SLOW);
    await openTerm(screen, 'Pria');
    await expect(screen.getByRole('dialog').getByRole('button', 'Delete')).toHaveCount(0);
  });

  test('MER-22 New Size takes the next free two-digit code on its own', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    const label = `Z${tag('S')}`;
    await openList(app, screen, '/master/sizes', 'Sizes');
    const before = new Set((await terms('sizes')).map((s) => s.code));
    let code: string | undefined;
    try {
      await addTerm(screen, 'Size', label);
      const made = await termByLabel('sizes', label);
      code = made?.code;
      expect(code).toMatch(/^\d{2}$/);
      expect(before.has(code!)).toBe(false);
      await screen.getByRole('textbox', /^Search/).fill(label);
      await expect(rowOf(screen, label)).toContainText(code!, SLOW);
      await expect(rowOf(screen, label)).toContainText('0 SKUs');
    } finally {
      if (code) await deleteTermApi('sizes', code);
    }
  });

  test('MER-23 a term cannot be deleted through the API once articles name it', { session: 'rina', tags: ['merchandise', 'vocabulary', 'api'] }, async () => {
    // The sheet hides Delete for a used term; the server is the authority and refuses it with the reason.
    const kaos = await termByCode('tags', 'KAOS');
    const res = await patchTermApi('tags', 'KAOS', { label: kaos!.label });
    expect(res.status).toBeLessThan(300);
    const gone = await cloudCall('DELETE', '/api/v1/vocabulary/tags/KAOS', undefined, { version: (await termByCode('tags', 'KAOS'))!.version });
    expect(gone.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(gone.body)).toContain('Retire it instead');
    expect(await termByCode('tags', 'KAOS')).toBeDefined();
  });

  test('MER-25 once an article carries a tag it reads 1 Article, and can no longer be deleted', { session: 'rina', tags: TAGS, timeout: 700_000 }, async ({ app, screen }) => {
    const art = await sharedArticle();
    const label = `Uji ${tag('P')}`;
    const made = await createTermApi('tags', label);
    const before = (await articleDetail(art.code)).tags as string[];
    try {
      const put = await patchArticle(art.code, { tags: [...before, made.code] });
      expect(put.status, JSON.stringify(put.body)).toBeLessThan(300);
      await openList(app, screen, '/master/tags', 'Tags');
      await screen.getByRole('textbox', /^Search/).fill(label);
      await expect(rowOf(screen, label)).toContainText('1 Article', SLOW);
      await openTerm(screen, label);
      await expect(screen.getByRole('dialog').getByRole('button', 'Delete')).toHaveCount(0);
      const u = await usage('tags', made.code);
      expect(u.can_delete).toBe(false);
      expect(JSON.stringify(u.references)).toContain('articles');
    } finally {
      await patchArticle(art.code, { tags: before });
      await deleteTermApi('tags', made.code);
    }
  });

  test('MER-26 a retired tag is no longer offered on the article form, an active one is', { session: 'rina', tags: TAGS, timeout: 700_000 }, async ({ app, screen }) => {
    const art = await sharedArticle();
    const live = `Uji ${tag('L')}`;
    const dead = `Uji ${tag('R')}`;
    const a = await createTermApi('tags', live);
    const b = await createTermApi('tags', dead);
    try {
      expect((await patchTermApi('tags', b.code, { active: false })).status).toBeLessThan(300);
      await app.open(`/master?article=${art.code}`);
      await screen.getByRole('dialog').getByRole('button', 'Edit').tap();
      await expect(screen.getByRole('dialog').getByRole('button', live)).toBeVisible(SLOW);
      await expect(screen.getByRole('dialog').getByRole('button', dead)).toHaveCount(0);
    } finally {
      await deleteTermApi('tags', a.code);
      await deleteTermApi('tags', b.code);
    }
  });

  test('MER-27 on a phone the list is cards with an Edit word on each', { session: 'rina', tags: TAGS }, async ({ app, screen, browser }) => {
    await browser.setViewport(viewports.phone);
    await openList(app, screen, '/master/tags', 'Tags');
    await expect(screen.getByRole('button', 'Edit Aksesori')).toBeVisible(SLOW);
    await expect(screen.getByText('Aksesori', { exact: true }).first()).toBeVisible();
    await screen.getByRole('button', 'Edit Aksesori').tap();
    await expect(screen.getByRole('dialog').getByRole('button', 'Save')).toBeVisible(SLOW);
  });

  test('MER-28 a merchandiser asks the app to add a tag and it is there', { session: 'rina', tags: [...TAGS, 'agent'] }, async ({ app, screen, agent }) => {
    const label = `Uji ${tag('A')}`;
    await openList(app, screen, '/master/tags', 'Tags');
    try {
      await agent.act('add a new tag named {label}', { params: { label: unique(label) } });
      await expect.poll(async () => (await termByLabel('tags', label))?.active, { timeout: 30_000 }).toBe(true);
      await screen.getByRole('textbox', /^Search/).fill(label);
      await expect(rowOf(screen, label)).toBeVisible(SLOW);
    } finally {
      await deleteTermApi('tags', label.toUpperCase().replace(/[^A-Z0-9]+/g, '_'));
    }
  });

  test('MER-24 Divisions, Tags and Sizes also open under Merchandise on /merchandise paths', { session: 'rina', tags: TAGS }, async ({ app, screen }) => {
    for (const [path, title] of [['/merchandise/divisions', 'Divisions'], ['/merchandise/tags', 'Tags'], ['/merchandise/sizes', 'Sizes']] as const) {
      await openList(app, screen, path, title);
      await expect(screen.getByRole('tab', /^Active/)).toBeVisible();
    }
  });
});
