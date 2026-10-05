import { node } from "@/lib/api"
import type {
  AcceptSolutionRequest,
  ChatConversation,
  ChatMessage,
  ChatSearchHit,
  CollaborationEvent,
  ConversationPreferencesRequest,
  DiscussionPerson,
  DiscussionPost,
  DiscussionThread,
  DismissedUnread,
  Document,
  DocumentLink,
  DocumentUpload,
  EditPostRequest,
  EditThreadRequest,
  FileInContext,
  OpenThreadRequest,
  PostReaction,
  PostRevision,
  ReactToPostRequest,
  ReplyRequest,
  SendMessageRequest,
  SetPinRequest,
  SetSubscriptionRequest,
  StartConversationRequest,
  StoredFile,
  SubjectCount,
  SubjectKindOption,
  TagCount,
} from "@itulah/contract"

/// Workplace reads and writes — discussions, chat, files, documents.
///
/// Four families over one idea: the record of what people said to each other
/// about the business. They share this module because they share a cache
/// namespace and a live cursor — a chat message and a discussion reply arrive
/// on the same numbered event stream, and splitting them would mean two
/// listeners racing to invalidate each other's keys.
///
/// Everything here is generated from the server's own structs
/// (`@itulah/contract`) except the document drawer, which is called out where
/// it starts.

// ─── Keys ────────────────────────────────────────────────────────────────────

/// One namespace, so signing out drops every answer in it by prefix.
///
/// `list` and `thread` are separated by a literal segment rather than left to
/// collide on their argument: a filter object and a thread id are both "the
/// third element", and the day somebody passes a string filter the two caches
/// become one.
export const workplaceKeys = {
  all: ["workplace"] as const,
  threads: (filter: ThreadFilter) =>
    ["workplace", "discussions", "list", filter] as const,
  thread: (threadId: string) =>
    ["workplace", "discussions", "thread", threadId] as const,
  posts: (threadId: string) =>
    ["workplace", "discussions", "thread", threadId, "posts"] as const,
  subjects: () => ["workplace", "discussions", "subjects"] as const,
  /// The board, one page at a time. Under `list` so every write that moves a
  /// row invalidates it with the rest of the board.
  threadPages: (filter: ThreadFilter) =>
    ["workplace", "discussions", "list", "pages", filter] as const,
  revisions: (threadId: string, postId: string) =>
    [
      "workplace",
      "discussions",
      "thread",
      threadId,
      "revisions",
      postId,
    ] as const,
  tags: () => ["workplace", "discussions", "tags"] as const,
  kinds: () => ["workplace", "discussions", "kinds"] as const,
  people: () => ["workplace", "discussions", "people"] as const,

  conversations: () => ["workplace", "chat", "conversations"] as const,
  conversation: (conversationId: string) =>
    ["workplace", "chat", "conversations", conversationId] as const,
  messages: (conversationId: string) =>
    ["workplace", "chat", "conversations", conversationId, "messages"] as const,
  conversationFiles: (conversationId: string) =>
    ["workplace", "chat", "conversations", conversationId, "files"] as const,
  pins: (conversationId: string) =>
    ["workplace", "chat", "conversations", conversationId, "pins"] as const,
  typing: (conversationId: string) =>
    ["workplace", "chat", "conversations", conversationId, "typing"] as const,
  /// Beside `conversations` rather than under it: a search result is not a
  /// room, and invalidating the rooms must not throw away what was found.
  chatSearch: (q: string, conversationId: string | null) =>
    ["workplace", "chat", "search", q, conversationId] as const,
  /// One follower per signed-in person. The username is in the key because the
  /// log is audience-filtered server-side: two people at the same desk must not
  /// share a cursor, and the second must not inherit the first's answers.
  events: (username: string) =>
    ["workplace", "chat", "events", username] as const,

  files: () => ["workplace", "files"] as const,

  documents: (filter: DocumentFilter) =>
    ["workplace", "documents", "list", filter] as const,
  document: (documentId: string) =>
    ["workplace", "documents", "document", documentId] as const,
}

// ─── Discussions ─────────────────────────────────────────────────────────────

/// What a DOCUMENT may be filed against.
///
/// A SHORTER list than a discussion's, and no longer a differently spelled
/// one. `0075_documents.sql` accepted five UPPERCASE words while a thread's
/// nine were lowercase, so `SUPPLIER` and `supplier` were two vocabularies
/// that happened to mean the same thing and could not be compared — which is
/// how the drawer came to offer the discussion's nine and have every one of
/// them rejected by a check constraint.
///
/// `0190` ends that: both read `record_kind`, the one list, lowercase. This is
/// still five, because a filing cabinet is not a forum — these are the things
/// somebody goes looking through one FOR. `GOODS_RECEIPT` is `receipt` now,
/// which is what the threads have called it since 0040.
export const DOCUMENT_SUBJECT_LABEL: Readonly<Record<string, string>> = {
  purchase_order: "Purchase order",
  supplier: "Supplier",
  receipt: "Goods receipt",
  article: "Article",
  supplier_item: "Supplier item",
}

export const DOCUMENT_SUBJECT_KINDS: readonly string[] = Object.keys(
  DOCUMENT_SUBJECT_LABEL
)

export function documentSubjectLabel(kind: string): string {
  return DOCUMENT_SUBJECT_LABEL[kind] ?? kind
}

/// `open` · `resolved` · `locked` are the three the server accepts. "Answered"
/// rather than "Resolved" on screen: the thing that changed is that somebody
/// marked a reply as the answer.
export const THREAD_STATUS_LABEL: Readonly<Record<string, string>> = {
  open: "Open",
  resolved: "Answered",
  locked: "Locked",
}

/// The reactions a post can carry — the server's closed set of six, in the
/// order it sends them, and what each looks like.
export const REACTIONS = [
  { value: "thumbs_up", emoji: "👍", label: "Agree" },
  { value: "heart", emoji: "❤️", label: "Thanks" },
  { value: "tada", emoji: "🎉", label: "Done" },
  { value: "laugh", emoji: "😄", label: "Ha" },
  { value: "eyes", emoji: "👀", label: "Looking at it" },
  { value: "check", emoji: "✅", label: "Confirmed" },
] as const

export function reactionEmoji(value: string): string {
  return REACTIONS.find((reaction) => reaction.value === value)?.emoji ?? value
}

/// How closely somebody follows a thread. `normal` is the resting level and
/// is never stored: the opener and everyone who has written in it hear about
/// replies, and anybody named with `@` hears about that.
export const SUBSCRIPTION_LEVELS = [
  {
    value: "watching",
    label: "Watching",
    hint: "Told about every reply, even without writing in it.",
  },
  {
    value: "normal",
    label: "Normal",
    hint: "Told about replies once you have written in it, and when named.",
  },
  {
    value: "muted",
    label: "Muted",
    hint: "Never told anything about this thread.",
  },
] as const

/// The feeds the server understands — see `ThreadQuery` in
/// `cloud/postgres/discussion.rs` — and nothing else. A tab with nothing
/// behind it would be a filter that quietly does nothing.
export type ThreadFeed = "unread" | "new" | "mine" | "bookmarked" | "watching"

/// The orders the server sorts by. Sorting there rather than here, because
/// the board is paged: re-ordering fifty rows in the browser would put the
/// busiest of the first page on top, not the busiest thread.
export type ThreadOrder = "activity" | "replies" | "views" | "created"

/// A page of the board holds this many threads.
export const THREAD_PAGE = 50

/// What the list is filtered to.
export interface ThreadFilter {
  readonly feed?: ThreadFeed
  readonly subjectKind?: string
  readonly subjectId?: string
  readonly tag?: string
  readonly status?: string
  readonly q?: string
  readonly order?: ThreadOrder
  readonly limit?: number
  readonly offset?: number
}

function threadQuery(filter: ThreadFilter): string {
  const params = new URLSearchParams()
  if (filter.feed !== undefined) params.set("feed", filter.feed)
  if (filter.subjectKind !== undefined)
    params.set("subject_kind", filter.subjectKind)
  if (filter.subjectId !== undefined) params.set("subject_id", filter.subjectId)
  if (filter.tag !== undefined) params.set("tag", filter.tag)
  if (filter.status !== undefined) params.set("status", filter.status)
  if (filter.q !== undefined && filter.q.trim() !== "")
    params.set("q", filter.q.trim())
  if (filter.order !== undefined && filter.order !== "activity")
    params.set("order", filter.order)
  if (filter.limit !== undefined) params.set("limit", String(filter.limit))
  if (filter.offset !== undefined && filter.offset > 0)
    params.set("offset", String(filter.offset))
  const query = params.toString()
  return query === "" ? "" : `?${query}`
}

/// One page of the board. Pinned threads come first on the plain board.
export function listThreads(filter: ThreadFilter, signal?: AbortSignal) {
  return node.get<DiscussionThread[]>(
    `/api/v1/discussions${threadQuery(filter)}`,
    { signal }
  )
}

export function subjectCounts(signal?: AbortSignal) {
  return node.get<SubjectCount[]>("/api/v1/discussions/subjects", { signal })
}

/// Every tag in use, busiest first — read from the tags, not from whichever
/// page of threads happens to be showing.
export function tagCounts(signal?: AbortSignal) {
  return node.get<TagCount[]>("/api/v1/discussions/tags", { signal })
}

/// The kinds of record a thread may be opened on, named — exactly what the
/// server accepts, so the composer cannot offer a word it would refuse.
export function subjectKinds(signal?: AbortSignal) {
  return node.get<SubjectKindOption[]>("/api/v1/discussions/kinds", {
    signal,
  })
}

/// Everything already opened, marked read to its end — "Dismiss" on Unread.
/// New threads stay new: only opening one counts somebody as having read it.
export function dismissUnread() {
  return node.post<DismissedUnread>("/api/v1/discussions/read", {})
}

/// Everybody who can be named with `@` — the active accounts and their names,
/// readable by anybody signed in, unlike the account administration list.
export function discussionPeople(signal?: AbortSignal) {
  return node.get<DiscussionPerson[]>("/api/v1/discussions/people", { signal })
}

/// Reading a thread records that this person has seen it — one row per person,
/// which is why the number beside it is people and not page loads — and moves
/// their reading position to the end. What comes back is where they stood
/// BEFORE this visit, which is where "new since your last visit" goes.
export function readThread(threadId: string, signal?: AbortSignal) {
  return node.get<DiscussionThread>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}`,
    { signal }
  )
}

export function readPosts(threadId: string, signal?: AbortSignal) {
  return node.get<DiscussionPost[]>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}/posts`,
    { signal }
  )
}

export function openThread(request: OpenThreadRequest) {
  return node.post<DiscussionThread>("/api/v1/discussions", request)
}

/// Retitle a thread, reword its note, refile its tags — all three stated.
export function editThread(threadId: string, request: EditThreadRequest) {
  return node.patch<DiscussionThread>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}`,
    request
  )
}

/// A reply, optionally to one earlier post.
///
/// The idempotency key is minted by the caller before the first attempt and
/// kept across retries, so a resend after a dropped connection lands once.
export function replyToThread(
  threadId: string,
  body: string,
  attachments: readonly string[],
  options: { replyTo?: number | null; idempotencyKey?: string } = {}
) {
  const request: ReplyRequest = {
    body,
    attachments: [...attachments],
    reply_to_seq: options.replyTo ?? null,
    idempotency_key: options.idempotencyKey ?? null,
  }
  return node.post<DiscussionPost>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}/posts`,
    request
  )
}

function postPath(threadId: string, postId: string) {
  return `/api/v1/discussions/${encodeURIComponent(threadId)}/posts/${encodeURIComponent(postId)}`
}

/// Correct a post. Its author only; the words it replaces are kept.
export function editPost(threadId: string, postId: string, body: string) {
  const request: EditPostRequest = { body }
  return node.patch<DiscussionPost>(postPath(threadId, postId), request)
}

/// Withdraw a post. It keeps its place in the thread and loses its words.
export function withdrawPost(threadId: string, postId: string) {
  return node.delete<DiscussionPost>(postPath(threadId, postId))
}

/// Every earlier wording of a post, oldest first.
export function postRevisions(
  threadId: string,
  postId: string,
  signal?: AbortSignal
) {
  return node.get<PostRevision[]>(`${postPath(threadId, postId)}/revisions`, {
    signal,
  })
}

/// Put a reaction on or take it off — stated, not toggled, so a double click
/// lands where it was meant.
export function reactToPost(
  threadId: string,
  postId: string,
  reaction: string,
  on: boolean
) {
  const request: ReactToPostRequest = { reaction, on }
  return node.post<PostReaction[]>(
    `${postPath(threadId, postId)}/reactions`,
    request
  )
}

/// Mark the reply that answered it, or `null` to say nothing has after all.
export function acceptSolution(threadId: string, postId: string | null) {
  const request: AcceptSolutionRequest = { post_id: postId }
  return node.post<DiscussionThread>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}/solution`,
    request
  )
}

export function setThreadStatus(threadId: string, status: string) {
  return node.post<DiscussionThread>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}/status`,
    { status }
  )
}

/// The caller's own bookmark and nobody else's. The answer is one boolean
/// because there is nothing else to say — no count, no list of who else marked
/// it, because the server never reads that table in aggregate.
export function setBookmark(threadId: string, marked: boolean) {
  return node.post<{ marked: boolean }>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}/bookmark`,
    { marked }
  )
}

/// How closely the caller follows it. Private, like a bookmark.
export function setSubscription(threadId: string, level: string) {
  const request: SetSubscriptionRequest = { level }
  return node.post<SetSubscriptionRequest>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}/subscription`,
    request
  )
}

/// Pin it above the board. Head office only; the server says so if not.
export function setPin(threadId: string, pinned: boolean) {
  const request: SetPinRequest = { pinned }
  return node.post<DiscussionThread>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}/pin`,
    request
  )
}

/// A file, fetched through the thread that carries it. The thread id in the
/// path is the permission check, not decoration: a file id lifted out of one
/// discussion cannot be pulled through another's URL.
export function discussionAttachmentUrl(threadId: string, fileId: string) {
  return `/api/v1/discussions/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(fileId)}`
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export function listConversations(signal?: AbortSignal) {
  return node.get<ChatConversation[]>("/api/v1/chat/conversations", { signal })
}

/// Start one. The caller is never in `participants` — the server puts them
/// there — and a DIRECT room between the same two people is the one that
/// already exists rather than a second copy of it, so this is safe to call
/// again on somebody already spoken to.
export function startConversation(request: StartConversationRequest) {
  return node.post<ChatConversation>("/api/v1/chat/conversations", request)
}

export function readConversation(conversationId: string, signal?: AbortSignal) {
  return node.get<ChatConversation>(
    `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}`,
    { signal }
  )
}

/// A window of a thread, oldest first.
///
/// Whatever the window, the server answers with the NEWEST `limit` messages
/// inside it: no cursor is the latest page, `before` scrolls back, `after` is
/// everything since a message the browser already holds (up to 500).
export function readMessages(
  conversationId: string,
  window: { after?: number; before?: number; limit?: number } = {},
  signal?: AbortSignal
) {
  const params = new URLSearchParams()
  if (window.after !== undefined) params.set("after", String(window.after))
  if (window.before !== undefined) params.set("before", String(window.before))
  if (window.limit !== undefined) params.set("limit", String(window.limit))
  const query = params.toString()
  return node.get<ChatMessage[]>(
    `${conversationPath(conversationId)}/messages${query === "" ? "" : `?${query}`}`,
    { signal }
  )
}

function conversationPath(conversationId: string) {
  return `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}`
}

function messagePath(conversationId: string, seq: number) {
  return `${conversationPath(conversationId)}/messages/${encodeURIComponent(String(seq))}`
}

/// Change the words. Only the author may; the server says so if not.
export function editMessage(conversationId: string, seq: number, body: string) {
  return node.patch<ChatMessage>(messagePath(conversationId, seq), { body })
}

/// Take it back. Answers with what is left — the message's place in the
/// thread, emptied.
export function deleteMessage(conversationId: string, seq: number) {
  return node.delete<ChatMessage>(messagePath(conversationId, seq))
}

/// Put a reaction on (`on: true`) or take it off. Stated, not toggled, so a
/// double click lands where the person meant.
export function reactToMessage(
  conversationId: string,
  seq: number,
  emoji: string,
  on: boolean
) {
  return node.post<ChatMessage>(
    `${messagePath(conversationId, seq)}/reactions`,
    {
      emoji,
      on,
    }
  )
}

export function pinMessage(
  conversationId: string,
  seq: number,
  pinned: boolean
) {
  return node.post<ChatMessage>(`${messagePath(conversationId, seq)}/pin`, {
    pinned,
  })
}

export function pinnedMessages(conversationId: string, signal?: AbortSignal) {
  return node.get<ChatMessage[]>(`${conversationPath(conversationId)}/pins`, {
    signal,
  })
}

/// Words in any room the reader is in, or in one of them. Fewer than two
/// characters answers nothing, on the server as well as here.
export function searchChat(
  q: string,
  conversationId: string | null,
  signal?: AbortSignal
) {
  const params = new URLSearchParams({ q })
  if (conversationId !== null) params.set("conversation_id", conversationId)
  return node.get<ChatSearchHit[]>(`/api/v1/chat/search?${params.toString()}`, {
    signal,
  })
}

export function renameConversation(conversationId: string, title: string) {
  return node.patch<ChatConversation>(conversationPath(conversationId), {
    title,
  })
}

/// The reader's own settings for a room. A field left out is left alone.
export function setConversationPreferences(
  conversationId: string,
  preferences: Partial<ConversationPreferencesRequest>
) {
  const request: ConversationPreferencesRequest = {
    muted: preferences.muted ?? null,
    pinned: preferences.pinned ?? null,
    archived: preferences.archived ?? null,
  }
  return node.put<ChatConversation>(
    `${conversationPath(conversationId)}/preferences`,
    request
  )
}

export function addParticipants(
  conversationId: string,
  participants: string[]
) {
  return node.post<ChatConversation>(
    `${conversationPath(conversationId)}/participants`,
    { participants }
  )
}

/// Remove somebody from a group, or — naming yourself — leave it. `undefined`
/// when the reader is no longer in the room afterwards (the server answers
/// `204`: there is no conversation left to show them).
export function removeParticipant(conversationId: string, username: string) {
  return node.delete<ChatConversation | undefined>(
    `${conversationPath(conversationId)}/participants/${encodeURIComponent(username)}`
  )
}

export function setParticipantAdmin(
  conversationId: string,
  username: string,
  isAdmin: boolean
) {
  return node.patch<ChatConversation>(
    `${conversationPath(conversationId)}/participants/${encodeURIComponent(username)}`,
    { is_admin: isAdmin }
  )
}

/// "I am typing", said at most every few seconds while somebody types.
export function reportTyping(conversationId: string) {
  return node.post<undefined>(`${conversationPath(conversationId)}/typing`, {})
}

export function whoIsTyping(conversationId: string, signal?: AbortSignal) {
  return node.get<string[]>(`${conversationPath(conversationId)}/typing`, {
    signal,
  })
}

/// Say something. The key is minted where the message is composed, not here:
/// a resend after a dropped connection has to carry the *same* key, and one
/// generated at the moment of sending would be a fresh one every attempt.
export function sendMessage(
  conversationId: string,
  request: SendMessageRequest
) {
  return node.post<ChatMessage>(
    `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
    request
  )
}

/// Move the read mark. The server answers with the conversation, so the unread
/// count on screen is its arithmetic rather than a second copy of it.
export function markRead(conversationId: string, lastReadSeq: number) {
  return node.post<ChatConversation>(
    `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/read`,
    { last_read_seq: lastReadSeq }
  )
}

export function conversationFiles(
  conversationId: string,
  signal?: AbortSignal
) {
  return node.get<StoredFile[]>(
    `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/files`,
    { signal }
  )
}

/// Where an attachment's bytes come from. The conversation id in the path is
/// the permission — there is deliberately no `/files/{id}` to link to instead,
/// because such a URL would work for somebody who was never in the room.
export function chatAttachmentUrl(conversationId: string, fileId: string) {
  return `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(fileId)}`
}

/// How many events one poll hands over. `EVENT_BATCH` in `cloud/http/chat.rs`
/// — a short batch is the signal that the caller has reached the head, so the
/// number has to match or the follower would poll forever thinking it is
/// behind.
export const EVENT_BATCH = 100

/// Catching up without holding a stream open.
///
/// `GET /chat/events?after=N` is the same query the SSE stream runs, so the
/// two cannot drift into showing different histories. Omitting `after` means
/// "start from now", which answers with nothing and no cursor — so a follower
/// that has never connected asks from `0` and winds forward instead.
export function collaborationEvents(after: number, signal?: AbortSignal) {
  return node.get<CollaborationEvent[]>(`/api/v1/chat/events?after=${after}`, {
    signal,
  })
}

// ─── Files ───────────────────────────────────────────────────────────────────

/// Every file the caller can actually reach, newest first.
///
/// Not a file system, and the shape says so: each row carries the room it
/// belongs to, because that room's route is the only way to open it. The rows
/// come from conversations this person is in, plus discussions, which
/// everybody signed in may read.
export function listFiles(limit = 200, signal?: AbortSignal) {
  return node.get<FileInContext[]>(`/api/v1/files?limit=${limit}`, { signal })
}

/// Upload first, attach afterwards.
///
/// Two steps on purpose: a photograph finishes uploading while the message is
/// still being typed, and the message then names a `file_id` it already has.
/// A slow attachment never blocks a send, and a send that fails does not lose
/// the upload. Name and content type travel as query parameters because that
/// is what `cloud/http/files.rs` reads — a header would widen the preflight,
/// and multipart would re-encode bytes the browser can hand to `fetch` as they
/// are.
export function uploadAttachment(file: File) {
  const params = new URLSearchParams({ name: file.name })
  if (file.type !== "") params.set("type", file.type)
  return node.upload<StoredFile>(`/api/v1/files?${params.toString()}`, file)
}

/// The one route that reaches a file's bytes, chosen by the room it came from.
export function fileUrl(row: FileInContext): string {
  return row.source_kind === "DISCUSSION"
    ? discussionAttachmentUrl(row.source_id, row.file.file_id)
    : chatAttachmentUrl(row.source_id, row.file.file_id)
}

// ─── Documents ───────────────────────────────────────────────────────────────

/// The document drawer, which no longer transcribes anything.
///
/// `Document`, `DocumentUpload`, `DocumentUploadRequest`, `DocumentLink` and
/// `FileDocumentRequest` are declared with `ts(export)` in
/// `cloud/postgres/documents.rs` and are now named in `contract_types.rs`, so
/// these four lines are the whole of the mirror that used to live here. It
/// mattered: 0358 gave a document a type, a number, an issuer and an expiry,
/// and the transcription would have gone on saying a STNK has no `expires_on`
/// while the server sent one — which is the failure the old comment predicted
/// and could not prevent.
///
/// `FileDocumentRequest` is the one that stays here, and for a reason rather
/// than by omission: three of its fields are `Vec` with `serde(default)`, so
/// the wire accepts their absence while the generated type demands them, and
/// `ts(optional)` cannot be said of a `Vec`. Until that is settled on the
/// server, the request keeps this spelling — with the expiry fields added, so
/// the drawer can file a paper that has one.

/// The drawer's record, under the name this module has always called it.
///
/// Generated, where it used to be transcribed: 0358 gave a document a type, a
/// number, an issuer and an expiry, and a hand-written mirror would have gone
/// on saying a STNK has no expiry while the server sent one. The local name
/// stays because two hundred lines below this read it as the drawer's own
/// record, and `Document` is a word the contract uses for several things.
export type WorkplaceDocument = Document

export interface DocumentFilter {
  readonly q?: string
  readonly tags?: readonly string[]
  readonly path?: readonly string[]
  readonly subjectKind?: string
  readonly subjectId?: string
  readonly limit?: number
}

function documentQuery(filter: DocumentFilter): string {
  const params = new URLSearchParams()
  if (filter.q !== undefined && filter.q.trim() !== "")
    params.set("q", filter.q.trim())
  if (filter.tags !== undefined && filter.tags.length > 0)
    params.set("tags", filter.tags.join(","))
  if (filter.path !== undefined && filter.path.length > 0)
    params.set("path", filter.path.join(","))
  if (filter.subjectKind !== undefined)
    params.set("subject_kind", filter.subjectKind)
  if (filter.subjectId !== undefined) params.set("subject_id", filter.subjectId)
  if (filter.limit !== undefined) params.set("limit", String(filter.limit))
  const query = params.toString()
  return query === "" ? "" : `?${query}`
}

export function searchDocuments(filter: DocumentFilter, signal?: AbortSignal) {
  return node.get<WorkplaceDocument[]>(
    `/api/v1/documents${documentQuery(filter)}`,
    { signal }
  )
}

export function readDocument(documentId: string, signal?: AbortSignal) {
  return node.get<WorkplaceDocument>(
    `/api/v1/documents/${encodeURIComponent(documentId)}`,
    { signal }
  )
}

/// A short-lived URL for the bytes — five minutes, issued rather than proxied
/// so a 20MB contract does not travel through a 512MB node.
///
/// Fetched on demand rather than held in a query: a link cached for the life
/// of a screen is a link that has expired by the time somebody clicks it.
export function documentDownloadUrl(documentId: string) {
  return node.get<{ url: string; expires_in_seconds: number }>(
    `/api/v1/documents/${encodeURIComponent(documentId)}/download-url`
  )
}

/// The bytes themselves, at a path that does not expire.
///
/// The sibling of `documentDownloadUrl`, and the one a tile can actually use.
/// A preview is an `<img src>` or an `<object data>`: the attribute is set once
/// when the tile paints, so a URL that has to be fetched first — and that dies
/// five minutes later — cannot go in it. This one is stable, same-origin, and
/// carries the session cookie the way every other request here does.
///
/// It is also the only way to open a document whose bytes are in the database
/// rather than in a bucket, which is every seeded one and every one filed on a
/// node with no object storage configured. `download-url` answers those with a
/// 404, because there is no key to presign.
export function documentContentUrl(documentId: string): string {
  return `/api/v1/documents/${encodeURIComponent(documentId)}/content`
}

export function reserveDocumentUpload(request: {
  file_name: string
  content_type?: string
}) {
  return node.post<DocumentUpload>("/api/v1/documents/upload-url", request)
}

export interface FileDocumentRequest {
  /// The reservation the bytes were PUT to. Exactly one of this and `file_id`.
  readonly upload_id?: string
  /// A file the node has already taken in — what `POST /files` answers with.
  /// The way in when there is no bucket to presign against, and the way an
  /// attachment already in a thread is filed without a second copy of it.
  readonly file_id?: string
  readonly file_name: string
  readonly content_type?: string
  readonly sha256?: string
  readonly title?: string
  readonly path_tokens?: readonly string[]
  readonly language?: string
  readonly doc_date?: string
  readonly tags?: readonly string[]
  readonly links?: readonly DocumentLink[]
  /// Kertas apa ini: "STNK", "BPKB", "Sertifikat laik operasi", "Garansi".
  readonly doc_type?: string
  readonly doc_number?: string
  readonly issuer?: string
  readonly issued_on?: string
  /// Masa berlakunya. Absen berarti kertasnya memang tidak punya.
  readonly expires_on?: string
}

export function fileDocument(request: FileDocumentRequest) {
  return node.post<WorkplaceDocument>("/api/v1/documents", request)
}

/// The hash the server cannot compute.
///
/// The bytes go straight to the bucket, so nothing on the node ever sees them.
/// The digest is asserted from here and recorded anyway, because two uploads
/// of the same contract should be visibly the same contract. `crypto.subtle`
/// exists only in a secure context, so a plain-HTTP development origin simply
/// files the document without one rather than failing the upload.
async function digestOf(file: File): Promise<string | undefined> {
  try {
    if (globalThis.crypto?.subtle === undefined) return undefined
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      await file.arrayBuffer()
    )
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  } catch {
    return undefined
  }
}

/// Filing a document, in the three steps the server actually asks for.
///
/// Reserve → PUT the bytes past this process → tell the node where they went.
/// The middle step is the one raw `fetch` in this app, and it is not talking
/// to the node: `upload_url` is a presigned object-store URL on another
/// origin, so it carries neither the session cookie nor the CSRF header, and
/// routing it through `node` would prepend our own base URL to it.
///
/// `upload_id` is what makes the last step safe to retry: the server finds the
/// object by the id it issued rather than by anything the caller made up, and
/// re-filing the same reservation cannot produce a second document.
///
/// # When there is no bucket
///
/// The first of the three steps needs one, and a node configured without object
/// storage answers it with a 404 saying so — which is every development node and
/// the one the seed runs against. Filing was therefore impossible there, and had
/// been since the drawer was written: the button existed and the first request
/// failed.
///
/// So a failed *reservation* falls back to `POST /files`, which takes the bytes
/// through the node and keeps them in the row. That is the same route every
/// attachment already uses, it works with or without a bucket, and it is only
/// reached when the presigned path is unavailable — a 20MB contract still goes
/// straight to the store wherever there is a store to go to.
export async function uploadDocument(
  file: File,
  details: Omit<
    FileDocumentRequest,
    "upload_id" | "file_id" | "file_name" | "content_type"
  >
): Promise<WorkplaceDocument> {
  const contentType = file.type === "" ? undefined : file.type

  let reservation: DocumentUpload
  try {
    reservation = await reserveDocumentUpload({
      file_name: file.name,
      content_type: contentType,
    })
  } catch {
    const stored = await uploadAttachment(file)
    return fileDocument({
      ...details,
      file_id: stored.file_id,
      file_name: file.name,
      content_type: contentType,
    })
  }

  const stored = await fetch(reservation.upload_url, {
    method: "PUT",
    body: file,
    headers:
      contentType === undefined ? undefined : { "content-type": contentType },
  })
  if (!stored.ok) {
    throw new Error(
      `the object store refused the upload (${stored.status}). Nothing was filed.`
    )
  }

  return fileDocument({
    ...details,
    upload_id: reservation.upload_id,
    file_name: file.name,
    content_type: contentType,
    sha256: await digestOf(file),
  })
}
