/*
 * Forum's backend boundary — the Go cloud-hub (github.com/retailos/backbone).
 *
 * There is no "discussion" doctype on Go. The threaded-discussion substrate is
 * the Records hub (internal/cloud/records): one Record per thread, whatever its
 * kind, with `title` as the subject, the free-form `body` as the opening post,
 * `/{id}/comments` as the replies, and `routing.queue` as the team the thread is
 * addressed to. DMs are the same engine with `kind: "dm"`; a forum topic is any
 * of the *org-visible* kinds.
 *
 *   GET  /api/v1/records                      → the topic list (offset paged)
 *   GET  /api/v1/records/{id}                 → {record, comments, attachments}
 *   GET  /api/v1/records/{id}/comments        → the reply stream
 *   POST /api/v1/records                      → open a topic (kind "ticket")
 *   POST /api/v1/records/{id}/comments        → post a reply
 *   GET  /api/v1/records/queues               → the category vocabulary
 *   GET  /api/v1/hr/employees                 → the people directory
 *
 * The client prefixes `/api`, so paths below start at `/v1/...`.
 *
 * What Go grounds that the Rust port could not:
 *
 * - Author display names. `requester_id` / `author_id` are employee ids
 *   (`emp-ho-004`), and /v1/hr/employees resolves them to `full_name`. Ids with
 *   no directory row (`seed`, the proxy actor) still show as a short id.
 * - Categories. `routing.queue` is a real, server-published vocabulary with
 *   labels — /v1/records/queues — not a shape derived from the rows.
 * - Participants. requester + assignee + watchers + every comment author.
 * - Rich bodies. A record body is free-form JSON: prose, a templated
 *   `{description, fields[]}`, or kind-specific scalars (a bill's amount and
 *   vendor). All three render as blocks.
 * - Writes. The records engine authenticates by API key and accepts an explicit
 *   author, so opening a topic and posting a reply are real, not previews.
 *
 * What Go genuinely does not publish, and is therefore absent rather than
 * invented: a view counter, thread pinning, marking a reply as the answer,
 * reply-to threading (comments are flat), and full-text search over records
 * (/v1/search indexes sku/customer/po/employee only — so the search box filters
 * the loaded rows client-side).
 */

import { keepPreviousData } from "@tanstack/react-query"

import {
  api,
  checkContract,
  qs,
  useDomainQuery,
  type ApiRequestOptions,
} from "@/lib/api"
import {
  EmployeeRow,
  QueueRow,
  RecordDetail,
  RecordRow,
} from "@/components/forum/contracts"
import { forumQueries } from "@/components/forum/queries"
import {
  type Category,
  type ForumTag,
  type Participant,
  type Post,
  type PostBlock,
  type Topic,
} from "@/components/forum/data"

/**
 * The actor the dev proxy authenticates as (`X-User-ID` in vite.config.ts).
 * The records engine derives its viewer from JWT claims, and an API-key session
 * carries none — so writes must name their author explicitly, and this is the
 * only id this session can honestly claim.
 */
export const FORUM_ACTOR = "slowdown-web"

/**
 * Kinds the forum board shows. `dm` is deliberately absent: the records plan
 * scopes it to the two people anchored to it, and the same rule that keeps DMs
 * off the shared task board keeps them off a shared board here.
 */
const BOARD_KINDS = new Set(["ticket", "document", "surat", "bill", "contract"])

interface ApiRecord {
  id?: unknown
  kind?: unknown
  subtype?: unknown
  title?: unknown
  body?: unknown
  priority?: unknown
  status?: unknown
  tags?: unknown
  store_id?: unknown
  requester_id?: unknown
  anonymous?: unknown
  routing?: unknown
  watchers?: unknown
  due_date?: unknown
  source?: unknown
  created_by?: unknown
  created_at?: unknown
  updated_at?: unknown
  closed_at?: unknown
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

interface ApiQueue {
  value?: unknown
  label?: unknown
}

interface ApiEmployee {
  id?: unknown
  full_name?: unknown
  employee_code?: unknown
}

/** id → display name, for every id Go can name. */
export type Directory = ReadonlyMap<string, string>

export interface ForumOverview {
  topics: Topic[]
  /** `routing.queue`, labelled from /v1/records/queues. */
  categories: Category[]
  tags: ForumTag[]
  directory: Directory
  fetchedAt: string
}

/** The feeds the records list route itself understands, as query filters. */
export type ForumFeed = "all" | "open" | "priority"

const PAGE_SIZE = 200
const MAX_PAGES = 20
/** Reply counts and comment authors only exist on the detail route. */
const HYDRATE_LIMIT = 120
const HYDRATE_CONCURRENCY = 6

const HUES = ["#0086fc", "#00c978", "#7b5cfa", "#ffbb26", "#ff58ae", "#64c6ff", "#ff3e00"]

/**
 * Statuses that close a record, per kind (records/types.go `closedStatus`).
 * A thread in one of these is done being answered.
 */
const TERMINAL_STATUS = new Set([
  "resolved",
  "closed",
  "cancelled",
  "archived",
  "rejected",
  "paid",
  "lapsed",
])

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim()
  if (value == null) return fallback
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return fallback
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => stringValue(entry)).filter(Boolean)
}

function listFrom<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) return payload as T[]
  const record = asRecord(payload)
  const value = record?.[key]
  return Array.isArray(value) ? (value as T[]) : []
}

function minutesSince(value: unknown): number {
  const raw = stringValue(value)
  if (!raw) return 0
  const timestamp = Date.parse(raw)
  if (!Number.isFinite(timestamp)) return 0
  return Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
}

function hueFor(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return HUES[hash % HUES.length]
}

/** "in_progress" → "In progress", "finance_ho" → "Finance ho". */
function humanize(value: string): string {
  const text = value.replace(/[_-]+/g, " ").trim()
  if (!text) return ""
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * A person, named from the HR directory when Go can name them. Ids with no
 * directory row (`seed`, a service actor) keep their id — short, and never a
 * fabricated handle.
 */
export function participantFor(id: string, directory: Directory): Participant {
  const key = id || "unknown"
  const named = directory.get(key)
  return {
    id: key,
    name: named || (key.length > 14 ? key.slice(0, 8) : key),
    hue: hueFor(key),
  }
}

/**
 * A record `body` is free-form JSON and three shapes are in circulation: bare
 * prose, a templated `{description, fields:[{label,value}]}`, and kind-specific
 * scalars (a bill's `amount` / `vendor`). Render all three; invent none.
 */
export function blocksFromBody(body: unknown): PostBlock[] {
  const blocks: PostBlock[] = []
  const paragraphs = (text: string) => {
    for (const chunk of text.split(/\n{2,}/)) {
      const trimmed = chunk.trim()
      if (trimmed) blocks.push({ kind: "p", text: trimmed })
    }
  }

  if (typeof body === "string") {
    paragraphs(body)
    return blocks
  }

  const record = asRecord(body)
  if (!record) return blocks

  paragraphs(stringValue(record.text) || stringValue(record.description))

  const items: string[] = []
  for (const field of listFrom<unknown>(record.fields, "fields")) {
    const entry = asRecord(field)
    if (!entry) continue
    const label = stringValue(entry.label) || humanize(stringValue(entry.name))
    const value = stringValue(entry.value)
    if (label && value) items.push(`${label}: ${value}`)
  }

  // Kind-specific scalars — a bill's amount and vendor, a document's custody.
  for (const [key, value] of Object.entries(record)) {
    if (key === "text" || key === "description" || key === "fields") continue
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      continue
    }
    const text = stringValue(value)
    if (text) items.push(`${humanize(key)}: ${text}`)
  }

  if (items.length) blocks.push({ kind: "ul", items })
  return blocks
}

/** The first prose the body carries, for the list preview. */
function previewFromBody(body: unknown): string {
  const first = blocksFromBody(body).find((block) => block.kind === "p")
  return first ? first.text.slice(0, 160) : ""
}

/** Reactions are `{emoji: [user_id]}`; the heart shows how many people reacted. */
function reactionCount(value: unknown): number {
  const record = asRecord(value)
  if (!record) return 0
  let total = 0
  for (const users of Object.values(record)) {
    if (Array.isArray(users)) total += users.length
  }
  return total
}

function queueOf(raw: ApiRecord): string {
  return stringValue(asRecord(raw.routing)?.queue)
}

function topicFromApi(raw: ApiRecord, directory: Directory): Topic | null {
  const id = stringValue(raw.id)
  const title = stringValue(raw.title)
  if (!id || !title) return null

  const status = stringValue(raw.status, "open").toLowerCase()
  const watchers = stringList(raw.watchers)
  const assignee = stringValue(asRecord(raw.routing)?.assignee_id)
  const requester = stringValue(raw.requester_id) || stringValue(raw.created_by)

  // Everyone Go names on the record itself. Comment authors join once the
  // thread is hydrated.
  const people: string[] = []
  for (const person of [requester, assignee, ...watchers]) {
    if (person && !people.includes(person)) people.push(person)
  }

  return {
    id,
    title,
    category: queueOf(raw),
    kind: stringValue(raw.kind),
    subtype: stringValue(raw.subtype),
    subjectId: stringValue(asRecord(raw.source)?.entity_id),
    storeId: stringValue(raw.store_id),
    status,
    statusLabel: humanize(status),
    terminal: TERMINAL_STATUS.has(status),
    priority: stringValue(raw.priority, "medium").toLowerCase(),
    tags: stringList(raw.tags),
    participants: people.map((person) => participantFor(person, directory)),
    replies: 0,
    watching: watchers.length,
    activity: minutesSince(raw.updated_at ?? raw.created_at),
    created: minutesSince(raw.created_at),
    preview: previewFromBody(raw.body),
    posts: [],
  }
}

/** The opening post is the record itself: its author, its date, its body. */
function openingPost(raw: ApiRecord, directory: Directory): Post {
  const id = stringValue(raw.id)
  const author = stringValue(raw.requester_id) || stringValue(raw.created_by)
  return {
    id: `${id}:opening`,
    author: raw.anonymous === true
      ? { id: "anonymous", name: "Anonymous", hue: hueFor("anonymous") }
      : participantFor(author, directory),
    age: minutesSince(raw.created_at),
    blocks: blocksFromBody(raw.body),
    likes: 0,
  }
}

function postFromComment(raw: ApiComment, directory: Directory): Post | null {
  const id = stringValue(raw.id)
  if (!id) return null
  return {
    id,
    author: participantFor(stringValue(raw.author_id), directory),
    age: minutesSince(raw.created_at),
    blocks: blocksFromBody(stringValue(raw.body)),
    likes: reactionCount(raw.reactions),
  }
}

/** Human replies only — system entries are the record's audit trail, not posts. */
function humanComments(comments: ApiComment[]): ApiComment[] {
  return comments.filter((comment) => comment.is_system !== true)
}

/**
 * The records list is offset-paged and reports a total, so walk it until the
 * rows run out rather than guessing a ceiling.
 */
async function fetchAllRecords(
  query: Record<string, string | number | boolean | undefined>,
  signal: AbortSignal | undefined,
): Promise<ApiRecord[]> {
  const options: ApiRequestOptions | undefined = signal ? { signal } : undefined
  const out: ApiRecord[] = []

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const path = `/v1/records${qs({ ...query, limit: PAGE_SIZE, offset: page * PAGE_SIZE })}`
    const payload = await api.get<unknown>(path, options)
    const items = listFrom<ApiRecord>(payload, "records")
    checkContract(RecordRow, items, path)
    out.push(...items)
    const total = numberValue(asRecord(payload)?.total, out.length)
    if (items.length < PAGE_SIZE || out.length >= total) break
  }

  return out
}

/** Run `work` over `items` a few at a time, so hydration is not a serial walk. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      out[index] = await work(items[index])
    }
  })
  await Promise.all(runners)
  return out
}

/**
 * The people directory. Records name employees by id; /v1/hr/employees is the
 * only thing that turns those ids into names, so a failure here costs names —
 * never rows.
 */
async function fetchDirectory(signal?: AbortSignal): Promise<Directory> {
  const options: ApiRequestOptions | undefined = signal ? { signal } : undefined
  const directory = new Map<string, string>()
  try {
    const path = "/v1/hr/employees?limit=500"
    const payload = await api.get<unknown>(path, options)
    const rows = listFrom<ApiEmployee>(payload, "employees")
    checkContract(EmployeeRow, rows, path)
    for (const entry of rows) {
      const id = stringValue(entry.id)
      const name = stringValue(entry.full_name)
      if (id && name) directory.set(id, name)
    }
  } catch {
    // Names are advisory; ids stay readable without them.
  }
  return directory
}

/** The category vocabulary, labelled by the server. */
async function fetchQueues(signal?: AbortSignal): Promise<Map<string, string>> {
  const options: ApiRequestOptions | undefined = signal ? { signal } : undefined
  const queues = new Map<string, string>()
  try {
    const path = "/v1/records/queues"
    const payload = await api.get<unknown>(path, options)
    const rows = listFrom<ApiQueue>(payload, "queues")
    checkContract(QueueRow, rows, path)
    for (const entry of rows) {
      const value = stringValue(entry.value)
      if (value) queues.set(value, stringValue(entry.label) || humanize(value))
    }
  } catch {
    // Fall back to the queues the loaded rows actually use.
  }
  return queues
}

/**
 * Reply counts and the faces that carried a thread live on the detail route
 * only, so the loaded page is hydrated one detail at a time. Failures leave the
 * row's own facts intact rather than dropping it.
 */
async function hydrate(
  topics: Topic[],
  directory: Directory,
  signal: AbortSignal | undefined,
): Promise<void> {
  const options: ApiRequestOptions | undefined = signal ? { signal } : undefined
  const targets = topics.slice(0, HYDRATE_LIMIT)

  await mapLimited(targets, HYDRATE_CONCURRENCY, async (topic) => {
    try {
      const detail = await api.get(`/v1/records/${encodeURIComponent(topic.id)}`, {
        ...options,
        schema: RecordDetail,
      })
      const comments = humanComments(detail.comments ?? [])
      topic.replies = comments.length

      const seen = new Set(topic.participants.map((p) => p.id))
      for (const comment of comments) {
        const author = stringValue(comment.author_id)
        if (!author || seen.has(author)) continue
        seen.add(author)
        topic.participants.push(participantFor(author, directory))
      }

      const last = comments[comments.length - 1]
      if (last) {
        const preview = stringValue(last.body)
        if (preview) topic.preview = preview.slice(0, 160)
      }
    } catch {
      // Keep the row; only its reply count stays at the record's own zero.
    }
  })
}

function categoriesFrom(topics: Topic[], queues: Map<string, string>): Category[] {
  const counts = new Map<string, number>()
  for (const topic of topics) {
    if (!topic.category) continue
    counts.set(topic.category, (counts.get(topic.category) ?? 0) + 1)
  }
  // Publish the whole vocabulary, so a queue with nothing in it is still a
  // destination the composer can address.
  for (const value of queues.keys()) {
    if (!counts.has(value)) counts.set(value, 0)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, count]) => ({
      id,
      label: queues.get(id) || humanize(id) || id,
      hue: hueFor(id),
      count,
    }))
}

/**
 * Record tags are free-form strings on the record; Go publishes no tag
 * vocabulary for them (masterdata/tags is the product taxonomy, systemtags the
 * computed performance labels). So the rail lists exactly the tags in use.
 */
function tagsFrom(topics: Topic[]): ForumTag[] {
  const counts = new Map<string, number>()
  for (const topic of topics) {
    for (const tag of topic.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: id, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** The list filters each feed sends to Go. */
function filtersFor(feed: ForumFeed): Record<string, string | boolean | undefined> {
  if (feed === "open") return { open: true }
  if (feed === "priority") return { priority: "high" }
  return {}
}

export async function fetchForumOverview(
  feed: ForumFeed = "all",
  signal?: AbortSignal,
): Promise<ForumOverview> {
  const [directory, queues, records] = await Promise.all([
    fetchDirectory(signal),
    fetchQueues(signal),
    fetchAllRecords(filtersFor(feed), signal),
  ])

  const topics = records
    .filter((raw) => BOARD_KINDS.has(stringValue(raw.kind)))
    .map((raw) => topicFromApi(raw, directory))
    .filter((topic): topic is Topic => topic !== null)

  await hydrate(topics, directory, signal)

  return {
    topics,
    categories: categoriesFrom(topics, queues),
    tags: tagsFrom(topics),
    directory,
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * One thread: the record's own body as the opening post, then its human
 * comments oldest first. Go's comments are flat — there is no parent link and
 * no "this is the answer" marker to render.
 */
export async function fetchTopicPosts(
  topicId: string,
  directory: Directory,
  signal?: AbortSignal,
): Promise<Post[]> {
  const options: ApiRequestOptions | undefined = signal ? { signal } : undefined
  const detail = await api.get(`/v1/records/${encodeURIComponent(topicId)}`, {
    ...options,
    schema: RecordDetail,
  })

  const posts: Post[] = []
  if (detail.record) {
    const opening = openingPost(detail.record, directory)
    if (opening.blocks.length > 0) posts.push(opening)
  }

  const comments = humanComments(detail.comments ?? []).sort(
    (a, b) => Date.parse(stringValue(a.created_at)) - Date.parse(stringValue(b.created_at)),
  )
  for (const comment of comments) {
    const post = postFromComment(comment, directory)
    if (post) posts.push(post)
  }

  return posts
}

/** A single record header, for deep links that skip the list. */
export async function fetchTopic(
  topicId: string,
  directory: Directory,
  signal?: AbortSignal,
): Promise<Topic | null> {
  const options: ApiRequestOptions | undefined = signal ? { signal } : undefined
  const detail = await api.get(`/v1/records/${encodeURIComponent(topicId)}`, {
    ...options,
    schema: RecordDetail,
  })
  return detail.record ? topicFromApi(detail.record, directory) : null
}

export interface NewTopicInput {
  title: string
  body: string
  /** A queue value from /v1/records/queues — the engine rejects unknown ones. */
  queue: string
  tags: string[]
}

/**
 * Open a topic. It is created as a `ticket`: the org-visible discussion kind,
 * the only one the engine lets an ordinary caller raise into a queue.
 */
export async function createTopic(input: NewTopicInput): Promise<string> {
  const created = await api.post<ApiRecord>("/v1/records", {
    kind: "ticket",
    title: input.title,
    body: { text: input.body },
    priority: "medium",
    tags: input.tags,
    routing: { queue: input.queue },
    requester_id: FORUM_ACTOR,
    created_by: FORUM_ACTOR,
  })
  return stringValue(created?.id)
}

/** Post a reply. The API-key session has no JWT subject, so name the author. */
export async function postReply(topicId: string, body: string): Promise<void> {
  await api.post<ApiComment>(
    `/v1/records/${encodeURIComponent(topicId)}/comments`,
    { body, author: FORUM_ACTOR },
  )
}

/*
 * ── Cache keys ──────────────────────────────────────────────────────────────
 *
 * Everything the forum reads or writes hangs off `forumQueries.all()`
 * (`["forum", …]`) — see queries.ts, the only place those keys are built.
 *
 * A write that changes a row's counters (a reply) invalidates the whole
 * ["forum"] subtree; opening a topic only changes the board, so it invalidates
 * ["forum", "overview"] and every feed under it.
 */

/* Switching feeds is a filtered-list navigation, so the previous board stays
 * on screen (rather than flashing empty) while the next one loads. See
 * docs/frontend-rules.md §Q7. */
export function useForumOverview(feed: ForumFeed = "all") {
  return useDomainQuery({
    ...forumQueries.overview(feed),
    placeholderData: keepPreviousData,
  })
}

/*
 * The stream closes over the directory, which is not in the key: it is a
 * name lookup, not a filter, and it arrives on the same overview response that
 * every invalidation of this thread also refetches. Keying on it would only
 * churn the cache each time the board reloaded.
 */
export function useTopicPosts(topicId: string | null, directory: Directory | undefined) {
  return useDomainQuery(forumQueries.posts(topicId, directory))
}

/**
 * `useCreateTopic` and `usePostReply` live in `./mutations` now, built on
 * `useMutation` directly — re-exported here so `forum.tsx` and
 * `new-topic-sheet.tsx` keep importing from this module unchanged. See
 * `./mutations` for the optimistic-shape reasoning (§M3).
 */
export { useCreateTopic, usePostReply } from "./mutations"
