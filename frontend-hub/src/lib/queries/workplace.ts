import { node } from "@/lib/api"
import type {
  ChatConversation,
  ChatMessage,
  CollaborationEvent,
  DiscussionPost,
  DiscussionThread,
  FileInContext,
  OpenThreadRequest,
  SendMessageRequest,
  StartConversationRequest,
  StoredFile,
  SubjectCount,
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

  conversations: () => ["workplace", "chat", "conversations"] as const,
  conversation: (conversationId: string) =>
    ["workplace", "chat", "conversations", conversationId] as const,
  messages: (conversationId: string) =>
    ["workplace", "chat", "conversations", conversationId, "messages"] as const,
  conversationFiles: (conversationId: string) =>
    ["workplace", "chat", "conversations", conversationId, "files"] as const,
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

/// The nine kinds of record a discussion can hang on, and what to call each on
/// screen.
///
/// Not categories somebody invented: a thread hangs on a RECORD, because a
/// conversation that is not about one is a conversation and there is a table
/// for those. So this is the left-hand axis of the screen — counts of work,
/// not of topics.
///
/// The nine below are the ones this screen draws a dot and a word for. The
/// server's list is longer since `0190` — it is `record_kind`, shared with the
/// activity log and the filing cabinet — and `subjectLabel` falls through to
/// the raw kind for anything not named here, so a thread opened against a
/// supplier bill reads `bill` rather than disappearing.
export const SUBJECT_LABEL: Readonly<Record<string, string>> = {
  purchase_order: "Purchase order",
  purchase_order_line: "PO line",
  supplier: "Supplier",
  receipt: "Receipt",
  purchase_exception: "Exception",
  commercial_verification: "Verification",
  packaging_item: "Packaging item",
  supply_item: "Supply item",
  article: "Article",
}

export const SUBJECT_KINDS: readonly string[] = Object.keys(SUBJECT_LABEL)

export function subjectLabel(kind: string): string {
  return SUBJECT_LABEL[kind] ?? kind
}

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

/// What the list is filtered to.
///
/// `bookmarked` and `mine` are the only two feeds the server understands — see
/// `ThreadQuery` in `cloud/postgres/discussion.rs` — and the screen offers
/// exactly those. A "following" tab with nothing behind it would be a filter
/// that quietly does nothing.
export interface ThreadFilter {
  readonly feed?: "bookmarked" | "mine"
  readonly subjectKind?: string
  readonly subjectId?: string
  readonly tag?: string
  readonly status?: string
  readonly q?: string
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
  const query = params.toString()
  return query === "" ? "" : `?${query}`
}

export function listThreads(filter: ThreadFilter, signal?: AbortSignal) {
  return node.get<DiscussionThread[]>(
    `/api/v1/discussions${threadQuery(filter)}`,
    { signal }
  )
}

export function subjectCounts(signal?: AbortSignal) {
  return node.get<SubjectCount[]>("/api/v1/discussions/subjects", { signal })
}

/// Reading a thread records that this person has seen it — one row per person,
/// which is why the number beside it is people and not page loads, and why it
/// moves the first time somebody looks and never again.
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

/// A reply. No `Idempotency-Key`: `POST /discussions/{id}/posts` does not read
/// one — unlike a chat message, whose key travels in the body because the
/// server's own `SendMessageRequest` carries it. The double-post guard here is
/// the disabled composer, and it is named as such at the call site.
export function replyToThread(
  threadId: string,
  body: string,
  attachments: readonly string[]
) {
  return node.post<DiscussionPost>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}/posts`,
    { body, attachments }
  )
}

export function acceptSolution(threadId: string, postId: string) {
  return node.post<DiscussionThread>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}/solution`,
    { post_id: postId }
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

export function readMessages(conversationId: string, signal?: AbortSignal) {
  return node.get<ChatMessage[]>(
    `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
    { signal }
  )
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

/// The document drawer's types are hand-written, and that is a real difference
/// from everything above.
///
/// `Document`, `DocumentUpload` and `DocumentLink` are all declared with
/// `ts(export)` in `cloud/postgres/documents.rs`, but no `.ts` for them exists
/// under `frontend-contract/src/contract/` — the drawer landed after the last
/// `make contract`. So these are transcribed from the Rust structs and are not
/// checked against the server at build time. If a document field reads
/// `undefined`, this block is the first place to look, and the fix is to
/// regenerate rather than to edit the shape here.

/// What a document is about. One row per link, so a delivery note may name
/// both the order it fulfils and the receipt that accepted it.
export interface DocumentLink {
  readonly subject_kind: string
  readonly subject_id: string
}

export interface WorkplaceDocument {
  readonly document_id: string
  readonly file_id: string
  readonly name: string
  readonly title: string | null
  /// The folder, as segments. An array rather than a string so a prefix can be
  /// matched without parsing separators, and "SS26/27" is not two folders.
  readonly path_tokens: readonly string[]
  readonly summary: string | null
  readonly language: string
  readonly processing_status: string
  readonly doc_date: string | null
  readonly byte_size: number
  readonly content_type: string
  /// Carried from `stored_file`, so the drawer can say "filed, but the object
  /// is gone" rather than hand out a link that fails.
  readonly available: boolean
  readonly tags: readonly string[]
  readonly links: readonly DocumentLink[]
  readonly uploaded_by: string
  readonly created_at: string
}

/// Somewhere to put the bytes. No row is written by this call: a reservation
/// that never finished uploading should leave nothing behind.
export interface DocumentUpload {
  readonly upload_id: string
  readonly upload_url: string
  readonly expires_in_seconds: number
}

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
