/*
 * Chat's backend boundary — the Go cloud-hub (`github.com/retailos/backbone`).
 *
 * There is no single chat collection on this backend. The screen is assembled
 * from three real surfaces, each with its own mount and its own auth:
 *
 *  1. `/api/v1/channels` (internal/cloud/channels) — team channels. Mounted
 *     behind `identity.JWTAuthMiddleware`, so it needs a *validated operator
 *     JWT*; the development proxy's API key is not enough and the whole subtree
 *     answers 401 to it. The rail therefore degrades to empty with a stated
 *     reason instead of failing the screen.
 *  2. `/api/v1/records?kind=dm` (internal/cloud/records) — the Records hub's DM
 *     lens. Mounted behind `apiKeyAuthMiddleware`, which the proxy satisfies.
 *     A record IS the conversation: its `title` is the subject, its `body` is
 *     the opening message, and `/comments` are the replies.
 *  3. `/api/v1/hr/employees` — the only directory the hub publishes. It is what
 *     gives a raw id like `emp-ho-003` a real name, position and department.
 *
 * Two conventions this backend actually uses, both opposite to the previous
 * (wrong) rewrite: listings page by `limit`/`offset`, never a cursor; and there
 * is no CSRF echo and no idempotency key on any of these mounts.
 *
 * One identity caveat drives several choices below. `apiKeyAuthMiddleware`
 * deliberately leaves `Claims.UserID` empty for a global API key, so every
 * records handler that derives the actor purely from claims — `react`, `watch`,
 * `unwatch` — answers 401 for this app. The two write paths that accept an
 * explicit actor in the body (`comments.author`, `record.created_by` /
 * `requester_id`) do work, and are used.
 */

import type { StandardSchemaV1 } from "@standard-schema/spec"

import {
  api,
  checkContract,
  isApiError,
  qs,
  useDomainQuery,
  type ApiRequestOptions,
} from "@/lib/api"
import { chatQueries } from "@/components/chat-app/queries"
import {
  AttachmentRow,
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ChatEmployeeRow,
  CommentRow,
  RecordRow,
} from "@/components/chat-app/contracts"
import {
  hueFor,
  type Channel,
  type ChannelMember,
  type ChatDirectory,
  type ChatPerson,
  type DirectConversation,
  type Message,
  type MessageAttachment,
  type Reaction,
} from "@/components/chat-app/data"

/**
 * The acting user id. The Vite proxy stamps `X-User-ID: slowdown-web` onto
 * every `/api` call (see vite.config.ts), and the hub has no endpoint that
 * echoes an API-key caller's identity back — `/api/v1/whoami` reports the
 * portal, not the user. This constant therefore mirrors the proxy rather than
 * guessing at a person.
 */
export const CURRENT_USER = "slowdown-web"

/** Records pages by offset; the handler's own default limit is 100. */
const PAGE_SIZE = 200
/** channels.listMessages defaults to limit=50; it accepts any positive limit. */
const MESSAGE_PAGE_SIZE = 200
const MAX_PAGES = 25

/* ─── raw hub shapes ──────────────────────────────────────────────────────── */

interface ApiEmployee {
  id?: unknown
  full_name?: unknown
  position?: unknown
  department?: unknown
  status?: unknown
}

interface ApiChannel {
  id?: unknown
  name?: unknown
  description?: unknown
  privacy?: unknown
  scope_type?: unknown
  scope_id?: unknown
  created_by?: unknown
  created_at?: unknown
  archived_at?: unknown
}

interface ApiChannelMember {
  user_id?: unknown
  role?: unknown
  removed_at?: unknown
}

interface ApiChannelMessage {
  id?: unknown
  channel_id?: unknown
  author_id?: unknown
  body?: unknown
  thread_root_id?: unknown
  is_system?: unknown
  mentions?: unknown
  attachments?: unknown
  created_at?: unknown
  edited_at?: unknown
  deleted_at?: unknown
}

interface ApiRecord {
  id?: unknown
  kind?: unknown
  subtype?: unknown
  title?: unknown
  body?: unknown
  status?: unknown
  tags?: unknown
  requester_id?: unknown
  anonymous?: unknown
  routing?: unknown
  watchers?: unknown
  created_by?: unknown
  created_at?: unknown
  updated_at?: unknown
}

interface ApiComment {
  id?: unknown
  record_id?: unknown
  author_id?: unknown
  body?: unknown
  is_system?: unknown
  event_type?: unknown
  reactions?: unknown
  created_at?: unknown
}

interface ApiAttachment {
  id?: unknown
  comment_id?: unknown
  file_name?: unknown
  content_type?: unknown
  size_bytes?: unknown
  url?: unknown
}

export interface ChatWorkspace {
  /** `/api/v1/channels`, empty when the JWT-only mount rejects this caller. */
  channels: Channel[]
  /** Why the channel rail is empty, when it is empty for a reason. */
  channelsError?: string
  /** Messages keyed by conversation id, for channels and DM records alike. */
  messages: Record<string, Message[]>
  /** `/api/v1/records?kind=dm`. */
  directMessages: DirectConversation[]
  /** Everyone `/api/v1/hr/employees` names, plus ids seen only in threads. */
  directory: ChatDirectory
  /** The id the proxy signs requests with. */
  currentUserId: string
  /** Active employees available to start a DM with. */
  people: ChatPerson[]
  /** Channel unread counts, keyed by channel id. */
  unread: Record<string, number>
  fetchedAt: string
}

/* ─── coercion ────────────────────────────────────────────────────────────── */

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function text(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : value == null
      ? ""
      : String(value)
}

function integer(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return fallback
}

function boolean(value: unknown): boolean {
  return value === true || value === 1 || value === "true"
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(text).filter(Boolean)
}

/** Every Go list handler answers `{ "<plural>": [...] }`; some also send total. */
function listOf<T>(payload: unknown, key: string): T[] {
  const body = record(payload)
  if (!body) return Array.isArray(payload) ? (payload as T[]) : []
  return Array.isArray(body[key]) ? (body[key] as T[]) : []
}

function minutesSince(value: unknown): number {
  const raw = text(value)
  if (!raw) return 0
  const timestamp = Date.parse(raw)
  if (!Number.isFinite(timestamp)) return 0
  return Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
}

function options(signal?: AbortSignal): ApiRequestOptions | undefined {
  return signal ? { signal } : undefined
}

/**
 * Records `body` is `json.RawMessage`: the seed stores `{ "text": "…" }` while
 * the compose path writes a bare string. Both are legal, so both are read.
 */
function bodyText(value: unknown): string {
  if (typeof value === "string") return value
  const body = record(value)
  return body ? text(body.text) : ""
}

/** Offset paging, the convention every mount here uses. */
async function fetchPaged<T>(
  path: string,
  key: string,
  pageSize: number,
  signal: AbortSignal | undefined,
  /** Checked against every page's rows via `checkContract` when given. */
  rowSchema?: StandardSchemaV1,
  /**
   * Report label for `checkContract`, when `path` itself carries a record
   * id (e.g. a channel id) that would otherwise fragment the once-per-
   * endpoint dedup gate into once-per-record. Defaults to `path`, which is
   * fine for an id-free route — `path` never carries the per-page
   * `limit`/`offset`, only `pagePath` below does.
   */
  reportPath?: string,
): Promise<T[]> {
  const out: T[] = []
  const label = reportPath ?? path
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * pageSize
    const pagePath = `${path}${qs({ limit: pageSize, offset })}`
    const payload = await api.get<unknown>(pagePath, options(signal))
    const rows = listOf<T>(payload, key)
    if (rowSchema) checkContract(rowSchema, rows, label)
    out.push(...rows)
    if (rows.length < pageSize) break
  }
  return out
}

function errorText(error: unknown, fallback: string): string {
  if (isApiError(error)) {
    if (error.unauthorized) {
      return "requires an operator session (this mount is JWT-only)"
    }
    if (error.forbidden) return "not permitted for this caller"
    return error.message
  }
  return error instanceof Error ? error.message : fallback
}

/* ─── directory ───────────────────────────────────────────────────────────── */

function personFrom(raw: ApiEmployee): ChatPerson | null {
  const id = text(raw.id)
  if (!id) return null
  const name = text(raw.full_name)
  return {
    id,
    name: name || id,
    named: Boolean(name),
    role: text(raw.position) || undefined,
    department: text(raw.department) || undefined,
    hue: hueFor(id),
  }
}

/**
 * `/api/v1/hr/employees` is the hub's only people directory. Everything here —
 * name, position, department — is a published field; nothing is derived from
 * the id beyond the avatar hue.
 */
async function fetchDirectory(
  signal?: AbortSignal,
): Promise<{ directory: ChatDirectory; people: ChatPerson[] }> {
  const path = `/v1/hr/employees${qs({ limit: 500 })}`
  const payload = await api.get<unknown>(path, options(signal))
  const rows = listOf<ApiEmployee>(payload, "employees")
  checkContract(ChatEmployeeRow, rows, path)
  const directory: ChatDirectory = {}
  const people: ChatPerson[] = []
  for (const raw of rows) {
    const person = personFrom(raw)
    if (!person) continue
    directory[person.id] = person
    if (text(raw.status) === "active" && person.id !== CURRENT_USER) {
      people.push(person)
    }
  }
  people.sort((left, right) => left.name.localeCompare(right.name))
  return { directory, people }
}

/* ─── channels ────────────────────────────────────────────────────────────── */

function memberFrom(raw: ApiChannelMember): ChannelMember | null {
  const id = text(raw.user_id)
  // Membership is soft-removed; a removed member keeps its history row.
  if (!id || text(raw.removed_at)) return null
  return { id, role: text(raw.role) || "member" }
}

function channelAttachments(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry): MessageAttachment | null => {
      const body = record(entry)
      if (!body) return null
      const id = text(body.id)
      const fileName = text(body.file_name)
      if (!id && !fileName) return null
      return {
        id: id || fileName,
        fileName: fileName || id,
        contentType: text(body.content_type) || undefined,
        url: text(body.url) || undefined,
      }
    })
    .filter((entry): entry is MessageAttachment => Boolean(entry))
}

function channelMessageFrom(raw: ApiChannelMessage): Message | null {
  const id = text(raw.id)
  // A deleted message keeps its row (DeletedAt); it is not rendered.
  if (!id || text(raw.deleted_at)) return null
  const attachments = channelAttachments(raw.attachments)
  const mentions = stringList(raw.mentions)
  return {
    id,
    authorId: text(raw.author_id),
    age: minutesSince(raw.created_at),
    text: text(raw.body),
    isSystem: boolean(raw.is_system) || undefined,
    replyToId: text(raw.thread_root_id) || undefined,
    mentions: mentions.length ? mentions : undefined,
    attachments: attachments.length ? attachments : undefined,
  }
}

function channelFrom(raw: ApiChannel, members: ChannelMember[]): Channel | null {
  const id = text(raw.id)
  if (!id) return null
  return {
    id,
    name: text(raw.name) || id,
    description: text(raw.description),
    privacy: text(raw.privacy) || "public",
    scopeType: text(raw.scope_type),
    scopeId: text(raw.scope_id),
    members,
    memberIds: members.map((member) => member.id),
    archived: Boolean(text(raw.archived_at)),
  }
}

interface ChannelBundle {
  channels: Channel[]
  messages: Record<string, Message[]>
  unread: Record<string, number>
  error?: string
}

/**
 * Reads the channel rail. The whole mount is behind a JWT, so a 401 here is
 * expected under API-key auth and is reported rather than thrown — the DM side
 * of the screen is independently available and must still render.
 */
async function fetchChannels(signal?: AbortSignal): Promise<ChannelBundle> {
  let rows: ApiChannel[]
  try {
    const payload = await api.get<unknown>("/v1/channels", options(signal))
    rows = listOf<ApiChannel>(payload, "channels")
    checkContract(ChannelRow, rows, "/v1/channels")
  } catch (error: unknown) {
    return {
      channels: [],
      messages: {},
      unread: {},
      error: errorText(error, "channels unavailable"),
    }
  }

  const channels: Channel[] = []
  const messages: Record<string, Message[]> = {}
  const unread: Record<string, number> = {}

  await Promise.all(
    rows.map(async (raw) => {
      const id = text(raw.id)
      if (!id) return
      const path = `/v1/channels/${encodeURIComponent(id)}`
      const [memberRows, messageRows, unreadPayload] = await Promise.all([
        api
          .get<unknown>(`${path}/members`, options(signal))
          .then((payload) => {
            const rows = listOf<ApiChannelMember>(payload, "members")
            checkContract(ChannelMemberRow, rows, "/v1/channels/:id/members")
            return rows
          })
          .catch(() => [] as ApiChannelMember[]),
        fetchPaged<ApiChannelMessage>(
          `${path}/messages`,
          "messages",
          MESSAGE_PAGE_SIZE,
          signal,
          ChannelMessageRow,
          "/v1/channels/:id/messages",
        ).catch(() => [] as ApiChannelMessage[]),
        api
          .get<unknown>(`${path}/unread-count`, options(signal))
          .catch(() => undefined),
      ])

      const members = memberRows
        .map(memberFrom)
        .filter((member): member is ChannelMember => Boolean(member))
      const channel = channelFrom(raw, members)
      if (!channel) return
      const count = integer(record(unreadPayload)?.unread)
      if (count > 0) {
        channel.unread = count
        unread[id] = count
      }
      channels.push(channel)
      messages[id] = messageRows
        .map(channelMessageFrom)
        .filter((message): message is Message => Boolean(message))
        .sort((left, right) => right.age - left.age)
    }),
  )

  channels.sort((left, right) => left.name.localeCompare(right.name))
  return { channels, messages, unread }
}

/* ─── direct messages (records, kind=dm) ──────────────────────────────────── */

/** `map[emoji][]user_id` — the count and `mine` are both read off that list. */
function reactionsFrom(value: unknown): Reaction[] | undefined {
  const body = record(value)
  if (!body) return undefined
  const reactions: Reaction[] = []
  for (const [emoji, raw] of Object.entries(body)) {
    const userIds = stringList(raw)
    if (!userIds.length) continue
    reactions.push({
      emoji,
      count: userIds.length,
      mine: userIds.includes(CURRENT_USER),
      userIds,
    })
  }
  return reactions.length ? reactions : undefined
}

function attachmentFrom(raw: ApiAttachment): MessageAttachment | null {
  const id = text(raw.id)
  if (!id) return null
  return {
    id,
    fileName: text(raw.file_name) || id,
    contentType: text(raw.content_type) || undefined,
    sizeBytes: integer(raw.size_bytes) || undefined,
    url: text(raw.url) || undefined,
  }
}

function commentFrom(
  raw: ApiComment,
  attachments: Map<string, MessageAttachment[]>,
): Message | null {
  const id = text(raw.id)
  if (!id) return null
  const files = attachments.get(id)
  return {
    id,
    authorId: text(raw.author_id),
    age: minutesSince(raw.created_at),
    text: text(raw.body),
    isSystem: boolean(raw.is_system) || undefined,
    eventType: text(raw.event_type) || undefined,
    reactions: reactionsFrom(raw.reactions),
    attachments: files?.length ? files : undefined,
  }
}

/**
 * The record itself is the first message of the thread: `body` is what the
 * sender wrote, authored by `requester_id` at `created_at`. The hub exposes no
 * reaction or delete route for it, so it is flagged as the opener.
 */
function openingMessage(
  raw: ApiRecord,
  attachments: MessageAttachment[],
): Message | null {
  const id = text(raw.id)
  const body = bodyText(raw.body)
  if (!id || !body) return null
  return {
    id: `${id}:opening`,
    authorId: boolean(raw.anonymous) ? "" : text(raw.requester_id) || text(raw.created_by),
    age: minutesSince(raw.created_at),
    text: body,
    isOpener: true,
    attachments: attachments.length ? attachments : undefined,
  }
}

/**
 * The counterpart of a DM. `watchers` is documented as "DM = the pair", so a
 * watcher who is not the caller wins; otherwise the requester, when that is
 * someone else. When the hub names nobody the thread keeps its subject line
 * rather than borrowing a person's name.
 */
function partnerOf(raw: ApiRecord): string {
  const watchers = stringList(raw.watchers).filter((id) => id !== CURRENT_USER)
  if (watchers.length) return watchers[0]
  const requester = text(raw.requester_id)
  if (requester && requester !== CURRENT_USER) return requester
  const creator = text(raw.created_by)
  return creator && creator !== CURRENT_USER ? creator : ""
}

function labelFor(id: string, directory: ChatDirectory): string {
  return directory[id]?.name ?? id
}

async function fetchDirectMessages(
  directory: ChatDirectory,
  signal?: AbortSignal,
): Promise<{
  directMessages: DirectConversation[]
  messages: Record<string, Message[]>
}> {
  const rows = await fetchPaged<ApiRecord>(
    `/v1/records${qs({ kind: "dm" })}`,
    "records",
    PAGE_SIZE,
    signal,
    RecordRow,
  )

  const directMessages: DirectConversation[] = []
  const messages: Record<string, Message[]> = {}

  await Promise.all(
    rows.map(async (raw) => {
      const id = text(raw.id)
      if (!id) return
      const path = `/v1/records/${encodeURIComponent(id)}`
      const [commentPayload, attachmentPayload] = await Promise.all([
        api.get<unknown>(`${path}/comments`, options(signal)),
        api
          .get<unknown>(`${path}/attachments`, options(signal))
          .catch(() => undefined),
      ])

      // Attachments are listed per record and carry the comment they belong to;
      // one with no comment_id belongs to the opening post.
      const byComment = new Map<string, MessageAttachment[]>()
      const opening: MessageAttachment[] = []
      const attachmentRows = listOf<ApiAttachment>(
        attachmentPayload,
        "attachments",
      )
      if (attachmentPayload !== undefined) {
        checkContract(AttachmentRow, attachmentRows, "/v1/records/:id/attachments")
      }
      for (const entry of attachmentRows) {
        const file = attachmentFrom(entry)
        if (!file) continue
        const commentId = text(entry.comment_id)
        if (!commentId) {
          opening.push(file)
          continue
        }
        byComment.set(commentId, [...(byComment.get(commentId) ?? []), file])
      }

      const thread: Message[] = []
      const first = openingMessage(raw, opening)
      if (first) thread.push(first)
      const commentRows = listOf<ApiComment>(commentPayload, "comments")
      checkContract(CommentRow, commentRows, "/v1/records/:id/comments")
      for (const entry of commentRows) {
        const message = commentFrom(entry, byComment)
        if (message) thread.push(message)
      }
      thread.sort((left, right) => right.age - left.age)
      messages[id] = thread

      const partnerId = partnerOf(raw)
      const routing = record(raw.routing)
      directMessages.push({
        id,
        partnerId: partnerId || undefined,
        partnerName: partnerId
          ? labelFor(partnerId, directory)
          : text(raw.title) || id,
        title: text(raw.title) || bodyText(raw.body) || "Direct message",
        messages: thread,
        updatedAt: text(raw.updated_at) || text(raw.created_at),
        status: text(raw.status) || "open",
        queue: text(routing?.queue) || undefined,
        tags: stringList(raw.tags),
      })
    }),
  )

  directMessages.sort((left, right) => {
    const rightTime = Date.parse(right.updatedAt)
    const leftTime = Date.parse(left.updatedAt)
    return (
      (Number.isFinite(rightTime) ? rightTime : 0) -
      (Number.isFinite(leftTime) ? leftTime : 0)
    )
  })

  return { directMessages, messages }
}

/* ─── workspace ───────────────────────────────────────────────────────────── */

export async function fetchChatWorkspace(
  signal?: AbortSignal,
): Promise<ChatWorkspace> {
  const [{ directory, people }, channelBundle] = await Promise.all([
    fetchDirectory(signal),
    fetchChannels(signal),
  ])
  const { directMessages, messages: dmMessages } = await fetchDirectMessages(
    directory,
    signal,
  )

  // Any id that appears in a thread but not in HR keeps its raw id as its
  // label — the directory is only extended so avatars resolve a stable hue.
  const merged: ChatDirectory = { ...directory }
  const note = (id: string) => {
    if (!id || merged[id]) return
    merged[id] = { id, name: id, named: false, hue: hueFor(id) }
  }
  for (const channel of channelBundle.channels) {
    for (const member of channel.memberIds) note(member)
  }
  for (const thread of Object.values({
    ...channelBundle.messages,
    ...dmMessages,
  })) {
    for (const message of thread) note(message.authorId)
  }
  for (const conversation of directMessages) {
    if (conversation.partnerId) note(conversation.partnerId)
  }
  note(CURRENT_USER)

  return {
    channels: channelBundle.channels,
    ...(channelBundle.error ? { channelsError: channelBundle.error } : {}),
    messages: { ...channelBundle.messages, ...dmMessages },
    directMessages,
    directory: merged,
    currentUserId: CURRENT_USER,
    people,
    unread: channelBundle.unread,
    fetchedAt: new Date().toISOString(),
  }
}

/* ─── cache keys ──────────────────────────────────────────────────────────── */

/** Which mount an open conversation lives on — they read and write differently. */
export type ConversationKind = "channel" | "dm"

export function useChatWorkspace() {
  return useDomainQuery(chatQueries.workspace())
}

/**
 * The open conversation's messages.
 *
 * Channels answer with the whole message list; a DM record answers with its
 * comments only — the record's own body is the opening post and is not a
 * comment, so the caller prepends it from the workspace snapshot.
 */
export function useConversationMessages(
  conversationId: string,
  kind: ConversationKind | null,
) {
  return useDomainQuery(chatQueries.messages(conversationId, kind))
}

/**
 * `useSendChatMessage`, `useToggleDirectReaction` and
 * `useCreateDirectConversation` live in `./mutations` now, built on
 * `useMutation` directly — re-exported here so `chat.tsx` keeps importing
 * from this module unchanged. See `./mutations` for the optimistic-shape
 * reasoning (§M3).
 */
export {
  useCreateDirectConversation,
  useSendChatMessage,
  useToggleDirectReaction,
  type CreateDirectConversationInput,
  type SendChatMessageInput,
  type ToggleReactionInput,
} from "./mutations"

/* ─── writes ──────────────────────────────────────────────────────────────── */

/**
 * Posts into a channel. `mentions` are resolved user ids and `thread_root_id`
 * threads the message under an existing one — both are real fields on
 * `channels.postMessage`.
 */
export async function sendChannelMessage(
  channelId: string,
  body: string,
  threadRootId?: string,
  mentions?: string[],
  signal?: AbortSignal,
): Promise<Message> {
  const payload = await api.post<ApiChannelMessage>(
    `/v1/channels/${encodeURIComponent(channelId)}/messages`,
    {
      body,
      ...(threadRootId ? { thread_root_id: threadRootId } : {}),
      ...(mentions?.length ? { mentions } : {}),
    },
    options(signal),
  )
  const message = channelMessageFrom(payload)
  if (!message) throw new Error("The hub returned an invalid channel message")
  return message
}

/**
 * Posts a reply into a DM record. `author` is sent explicitly because the API
 * key leaves `Claims.UserID` empty, and the handler would otherwise store the
 * comment with no author at all.
 */
export async function sendDirectMessage(
  recordId: string,
  body: string,
  signal?: AbortSignal,
): Promise<Message> {
  const payload = await api.post<ApiComment>(
    `/v1/records/${encodeURIComponent(recordId)}/comments`,
    { body, author: CURRENT_USER },
    options(signal),
  )
  const message = commentFrom(payload, new Map())
  if (!message) throw new Error("The hub returned an invalid comment")
  return message
}

/**
 * Toggles an emoji reaction on a DM reply. The hub accepts any emoji string and
 * answers with the refreshed thread. It derives the reactor from session claims
 * only, so this route answers 401 under the app's API-key auth — the error is
 * surfaced rather than faked away.
 */
export async function toggleDirectReaction(
  recordId: string,
  commentId: string,
  emoji: string,
  signal?: AbortSignal,
): Promise<Message[]> {
  const payload = await api.post<unknown>(
    `/v1/records/${encodeURIComponent(recordId)}/comments/${encodeURIComponent(commentId)}/react`,
    { emoji },
    options(signal),
  )
  return listOf<ApiComment>(payload, "comments")
    .map((entry) => commentFrom(entry, new Map()))
    .filter((message): message is Message => Boolean(message))
}

/** Re-reads one DM thread's replies (the opening post is held by the caller). */
export async function fetchDirectReplies(
  recordId: string,
  signal?: AbortSignal,
): Promise<Message[]> {
  const path = `/v1/records/${encodeURIComponent(recordId)}/comments`
  const payload = await api.get<unknown>(path, options(signal))
  const rows = listOf<ApiComment>(payload, "comments")
  checkContract(CommentRow, rows, "/v1/records/:id/comments")
  return rows
    .map((entry) => commentFrom(entry, new Map()))
    .filter((message): message is Message => Boolean(message))
}

/** Re-reads one channel's messages. */
export async function fetchChannelMessages(
  channelId: string,
  signal?: AbortSignal,
): Promise<Message[]> {
  const rows = await fetchPaged<ApiChannelMessage>(
    `/v1/channels/${encodeURIComponent(channelId)}/messages`,
    "messages",
    MESSAGE_PAGE_SIZE,
    signal,
    ChannelMessageRow,
    "/v1/channels/:id/messages",
  )
  return rows
    .map(channelMessageFrom)
    .filter((message): message is Message => Boolean(message))
    .sort((left, right) => right.age - left.age)
}

/**
 * Advances a channel's read cursor. DM records have no read cursor on this
 * backend, so there is nothing to call for them.
 */
export async function markChannelRead(
  channelId: string,
  lastMessageId?: string,
  signal?: AbortSignal,
): Promise<void> {
  await api.post<unknown>(
    `/v1/channels/${encodeURIComponent(channelId)}/read`,
    lastMessageId ? { last_message_id: lastMessageId } : {},
    options(signal),
  )
}

/**
 * Opens a DM by creating the `kind: "dm"` record. Records have no delete route,
 * so this is deliberately called only when there is a first message to send —
 * the screen holds an unsent conversation locally until then.
 *
 * `created_by` / `requester_id` are sent explicitly for the same reason
 * `comments.author` is: the API key carries no user id in its claims.
 */
export async function createDirectConversation(
  partnerId: string,
  title: string,
  body: string,
  signal?: AbortSignal,
): Promise<string> {
  const payload = await api.post<ApiRecord>(
    "/v1/records",
    {
      kind: "dm",
      title,
      body,
      priority: "medium",
      watchers: [partnerId],
      created_by: CURRENT_USER,
      requester_id: CURRENT_USER,
    },
    options(signal),
  )
  const id = text(payload.id)
  if (!id) throw new Error("The hub returned no record id")
  return id
}
