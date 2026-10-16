// Workplace: Discussions (threads about a record), Chat (rooms) and Files
// (the library). Threads and rooms are made through the API with this run's
// tag in their title; replies and messages go through the screens.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { viewports } from '../../support/base.ts';
import { steady, rows, SLOW, tag, L } from '../../support/stores-ga.ts';

const rinaApi = () => steady('cloud', 'rina');
const thread = (t: string, over: Record<string, unknown> = {}) =>
  rinaApi().post('/api/v1/discussions', { subject_kind: 'supplier', subject_id: '0001', subject_note: null, title: `Diskusi Uji ${t}`, body: `Pembuka uji ${t}`, tags: ['e2e'], attachments: [], ...over });
const room = (t: string) => rinaApi().post('/api/v1/chat/conversations', { kind: 'GROUP', title: `Ruang Uji ${t}`, participants: ['maya'] });

describe('Workplace: discussions', { tags: ['workplace'] }, () => {
  test('WP-01 the list shows a thread with its title, the filters and the categories rail', { session: 'rina', tags: ['workplace', 'smoke'] }, async ({ app, screen }) => {
    const t = tag('D');
    await thread(t);
    await app.open('/discussions');
    await expect(screen.getByRole('heading', 'Discussions')).toBeVisible({ timeout: SLOW });
    for (const chip of ['All', 'Unread', 'New', 'Mine', 'Bookmarked', 'Watching']) await expect(screen.getByRole('button', chip).first()).toBeVisible();
    await expect(screen.getByText(`Diskusi Uji ${t}`)).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(/\d+ threads?/).first()).toBeVisible();
  });

  test('WP-02 a thread opens from the address with its opening post and a reply box', { session: 'rina', tags: ['workplace'] }, async ({ app, screen }) => {
    const t = tag('E');
    const th = await thread(t);
    await app.open(`/discussions?thread=${th.thread_id}`);
    await expect(screen.getByText(`Pembuka uji ${t}`).first()).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('button', 'Post reply')).toBeDisabled();
    await expect(screen.getByRole('button', 'Bookmark')).toBeVisible();
    await expect(screen.getByRole('button', 'Copy link')).toBeVisible();
  });

  test('WP-03 a reply typed in the box is posted and counted', { session: 'rina', tags: ['workplace'] }, async ({ app, screen }) => {
    const t = tag('F');
    const th = await thread(t);
    await app.open(`/discussions?thread=${th.thread_id}`);
    await screen.getByLabel(L('Post')).fill(`Balasan uji ${t}`);
    await screen.getByRole('button', 'Post reply').tap();
    await expect(screen.getByText(`Balasan uji ${t}`).first()).toBeVisible({ timeout: SLOW });
    const posts = (await rinaApi().get(`/api/v1/discussions/${th.thread_id}/posts`)) as { body: string }[];
    expect(posts.some((p) => p.body.includes(`Balasan uji ${t}`))).toBe(true);
  });

  test('WP-04 Bookmark toggles the thread into the Bookmarked filter', { session: 'rina', tags: ['workplace'] }, async ({ app, screen }) => {
    const t = tag('G');
    const th = await thread(t);
    await app.open(`/discussions?thread=${th.thread_id}`);
    await screen.getByRole('button', 'Bookmark').tap();
    await expect(screen.getByRole('button', 'Bookmarked').first()).toBeVisible({ timeout: SLOW });
    const mine = (await rinaApi().get('/api/v1/discussions?limit=200')) as { thread_id: string; bookmarked_by_me: boolean }[];
    expect((rows(mine).length ? rows(mine) : mine).find((x) => x.thread_id === th.thread_id)?.bookmarked_by_me).toBe(true);
  });

  test('WP-05 the search narrows the list to the thread by its title', { session: 'rina', tags: ['workplace'] }, async ({ app, screen }) => {
    const t = tag('H');
    await thread(t);
    await app.open('/discussions');
    await screen.getByRole('textbox').first().fill(`Diskusi Uji ${t}`);
    await expect(screen.getByText(`Diskusi Uji ${t}`)).toBeVisible({ timeout: SLOW });
    await screen.getByRole('textbox').first().fill('zzz-tidak-ada');
    await expect(screen.getByText(`Diskusi Uji ${t}`)).toBeHidden({ timeout: SLOW });
  });

  test('WP-08 a thread rina opened is under Mine', { session: 'rina', tags: ['workplace'] }, async ({ app, screen }) => {
    const t = tag('MI');
    const th = await thread(t);
    expect(th.created_by).toBe('rina');
    await app.open('/discussions');
    await screen.getByRole('button', 'Mine').tap();
    await expect(screen.getByText(`Diskusi Uji ${t}`)).toBeVisible({ timeout: SLOW });
  });

  test('WP-06 Open a thread asks what it is about, which one, a title and the opening post', { session: 'rina', tags: ['workplace'] }, async ({ app, screen }) => {
    await app.open('/discussions');
    await screen.getByRole('button', 'Open a thread', { visible: true }).tap();
    await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('combobox', { name: /^What it is about/ })).toBeVisible();
    await expect(screen.getByRole('textbox', { name: /^Which one/ })).toBeVisible();
    await expect(screen.getByRole('textbox', { name: /^Title/ })).toBeVisible();
    await expect(screen.getByRole('textbox', 'The opening post')).toBeVisible();
    await expect(screen.getByText('A thread with no opening argument is a title.')).toBeVisible();
  });

  test('WP-07 phone: the list is cards, with Open a thread as the round button', { session: 'rina', tags: ['workplace'] }, async ({ app, screen, browser }) => {
    const t = tag('I');
    await thread(t);
    await browser.setViewport(viewports.phone);
    await app.open('/discussions');
    await expect(screen.getByRole('button', 'Open a thread', { visible: true })).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(`Diskusi Uji ${t}`)).toBeVisible();
  });
});

describe('Workplace: chat', { tags: ['workplace'] }, () => {
  test('WP-20 the rooms list shows the room, its filters and the empty detail pane', { session: 'rina', tags: ['workplace', 'smoke'] }, async ({ app, screen }) => {
    const t = tag('C');
    await room(t);
    await app.open('/chat');
    await expect(screen.getByRole('heading', 'Chat')).toBeVisible({ timeout: SLOW });
    for (const chip of ['All', 'Unread', 'Groups', 'Archived']) await expect(screen.getByRole('button', chip).first()).toBeVisible();
    await expect(screen.getByText(`Ruang Uji ${t}`).first()).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(/Pick a conversation on the left/)).toBeVisible();
  });

  test('WP-21 a room opens by its address and a message sent from the box is stored', { session: 'rina', tags: ['workplace'] }, async ({ app, screen }) => {
    const t = tag('M');
    const r = await room(t);
    await app.open(`/chat?conversation=${r.conversation_id}`);
    await expect(screen.getByLabel(L('Message'))).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('button', 'Send')).toBeDisabled();
    await screen.getByLabel(L('Message')).fill(`Halo uji ${t}`);
    await screen.getByRole('button', 'Send').tap();
    await expect(screen.getByText(`Halo uji ${t}`).first()).toBeVisible({ timeout: SLOW });
    // The bubble shows at once; the room keeps it only once the server has it.
    await expect.poll(async () => JSON.stringify(await rinaApi().get(`/api/v1/chat/conversations/${r.conversation_id}/messages`)), { timeout: SLOW }).toContain(`Halo uji ${t}`);
  });

  test('WP-22 a message from the other person raises the room\'s unread count, opening it clears it', { session: 'rina', tags: ['workplace'] }, async ({ app, screen }) => {
    const t = tag('U');
    const r = await room(t);
    await steady('cloud', 'maya').post(`/api/v1/chat/conversations/${r.conversation_id}/messages`, { body: `dari maya ${t}`, idempotency_key: crypto.randomUUID(), reply_to_seq: null, attachments: [] });
    const before = (await rinaApi().get('/api/v1/chat/conversations')) as { conversation_id: string; unread_count: number }[];
    expect(before.find((c) => c.conversation_id === r.conversation_id)?.unread_count).toBe(1);
    await app.open(`/chat?conversation=${r.conversation_id}`);
    await expect(screen.getByText(`dari maya ${t}`).first()).toBeVisible({ timeout: SLOW });
    await expect.poll(async () => ((await rinaApi().get('/api/v1/chat/conversations')) as { conversation_id: string; unread_count: number }[]).find((c) => c.conversation_id === r.conversation_id)?.unread_count, { timeout: SLOW }).toBe(0);
  });

  test('WP-23 New conversation offers One person or A group, asks who, and Start waits for an answer', { session: 'rina', tags: ['workplace'] }, async ({ app, screen }) => {
    await app.open('/chat');
    await screen.getByRole('button', 'New conversation').first().tap();
    await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('button', 'One person', { pressed: true })).toBeVisible();
    await expect(screen.getByRole('combobox', 'Who')).toBeVisible();
    await expect(screen.getByRole('button', 'Start')).toBeDisabled();
    await screen.getByRole('button', 'A group').tap();
    await expect(screen.getByRole('textbox', { name: /^Name/ })).toBeVisible();
    await expect(screen.getByRole('combobox', 'Who else')).toBeVisible();
  });

  test('WP-25 About this conversation: pinning the room is kept by the server for this person only', { session: 'rina', tags: ['workplace'] }, async ({ app, screen }) => {
    const t = tag('PN');
    const r = await room(t);
    await app.open(`/chat?conversation=${r.conversation_id}`);
    await screen.getByRole('button', 'About this conversation').tap();
    const pin = screen.getByRole('checkbox', 'Pin to the top of the list');
    await expect(pin).toBeVisible({ timeout: SLOW });
    await pin.tap();
    const mine = async (who: 'rina' | 'maya') => ((await steady('cloud', who).get('/api/v1/chat/conversations')) as { conversation_id: string; pinned: boolean }[]).find((c) => c.conversation_id === r.conversation_id)?.pinned;
    await expect.poll(() => mine('rina'), { timeout: SLOW }).toBe(true);
    expect(await mine('maya')).toBe(false);
  });

  test('WP-26 Archive takes the room out of the All list until somebody writes in it', { session: 'rina', tags: ['workplace'] }, async ({ app, screen }) => {
    const t = tag('AR');
    const r = await room(t);
    await app.open(`/chat?conversation=${r.conversation_id}`);
    await screen.getByRole('button', 'About this conversation').tap();
    await screen.getByRole('checkbox', { name: /^Archive/ }).tap();
    await expect.poll(async () => ((await rinaApi().get('/api/v1/chat/conversations')) as { conversation_id: string; archived: boolean }[]).find((c) => c.conversation_id === r.conversation_id)?.archived, { timeout: SLOW }).toBe(true);
    await app.open('/chat');
    await expect(screen.getByRole('button', 'All')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(`Ruang Uji ${t}`)).toBeHidden();
    await screen.getByRole('button', 'Archived').tap();
    await expect(screen.getByText(`Ruang Uji ${t}`).first()).toBeVisible({ timeout: SLOW });
  });

  test('WP-24 the search box finds a person or a message', { session: 'rina', tags: ['workplace'] }, async ({ app, screen }) => {
    await app.open('/chat');
    await screen.getByLabel(L('Search people and messages')).fill('Maya');
    await expect(screen.getByText('Maya Anggraini').first()).toBeVisible({ timeout: SLOW });
  });
});

describe('Workplace: files', { tags: ['workplace'] }, () => {
  test('WP-40 Files opens as a library with Grid and List, Add a file and the saved views', { session: 'rina', tags: ['workplace'] }, async ({ app, screen }) => {
    await app.open('/library');
    await expect(screen.getByRole('heading', 'Files')).toBeVisible({ timeout: SLOW });
    for (const b of ['Grid', 'List', 'Add a file']) await expect(screen.getByRole('button', b).first()).toBeVisible();
    await expect(screen.getByLabel(L('Search the library'))).toBeVisible();
    await screen.getByRole('button', 'List').tap();
    await expect(screen.getByRole('button', 'List')).toBeVisible();
  });
});
