import { node } from "@/lib/api"
import { subscribeToCollaboration } from "@/lib/collaboration"
import type {
  AcceptSolutionRequest,
  DiscussionPost,
  DiscussionThread,
  OpenThreadRequest,
  ReplyRequest,
  SetBookmarkRequest,
  SetThreadStatusRequest,
  SubjectCount,
} from "@itulah/contract"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

/// The nine kinds of record a discussion can hang on, and what to call each on
/// screen.
///
/// Not categories. `0040_collaboration.sql` enforces this list in a CHECK
/// constraint and says why: a thread that is not about a record is a
/// conversation, and there is a table for those. So this is the left-hand axis
/// of the screen — counts of work, not of topics somebody invented.
export const SUBJECT_LABEL: Record<string, string> = {
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

export const SUBJECT_KINDS = Object.keys(SUBJECT_LABEL)

export function subjectLabel(kind: string): string {
  return SUBJECT_LABEL[kind] ?? kind
}

export const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  resolved: "Answered",
  locked: "Locked",
}

/// What the list is filtered to. `bookmarked` and `mine` are the only two the
/// server understands — see `ThreadQuery` — and the screen offers exactly
/// those: a "following" tab with nothing behind it would be a filter that
/// quietly does nothing.
export interface ThreadFilter {
  readonly feed?: "bookmarked" | "mine"
  readonly subjectKind?: string
  readonly subjectId?: string
  readonly tag?: string
  readonly status?: string
  readonly q?: string
}

export const threadsKey = (filter: ThreadFilter) => ["discussions", filter] as const
export const threadKey = (threadId: string) => ["discussions", "thread", threadId] as const
export const postsKey = (threadId: string) => ["discussions", "posts", threadId] as const
export const subjectCountsKey = () => ["discussions", "subjects"] as const

function threadQuery(filter: ThreadFilter): string {
  const params = new URLSearchParams()
  if (filter.feed !== undefined) params.set("feed", filter.feed)
  if (filter.subjectKind !== undefined) params.set("subject_kind", filter.subjectKind)
  if (filter.subjectId !== undefined) params.set("subject_id", filter.subjectId)
  if (filter.tag !== undefined) params.set("tag", filter.tag)
  if (filter.status !== undefined) params.set("status", filter.status)
  if (filter.q !== undefined && filter.q.trim() !== "") params.set("q", filter.q.trim())
  const query = params.toString()
  return query === "" ? "" : `?${query}`
}

export function listThreads(
  filter: ThreadFilter,
  signal?: AbortSignal,
): Promise<DiscussionThread[]> {
  return node.get<DiscussionThread[]>(`/api/v1/discussions${threadQuery(filter)}`, { signal })
}

export function subjectCounts(signal?: AbortSignal): Promise<SubjectCount[]> {
  return node.get<SubjectCount[]>("/api/v1/discussions/subjects", { signal })
}

/// Opening a thread records that this person has seen it — one row per person.
/// That is why the number beside a thread is people and not page loads, and
/// why it goes up the first time you look and never again.
export function readThread(threadId: string, signal?: AbortSignal): Promise<DiscussionThread> {
  return node.get<DiscussionThread>(`/api/v1/discussions/${encodeURIComponent(threadId)}`, {
    signal,
  })
}

export function readPosts(threadId: string, signal?: AbortSignal): Promise<DiscussionPost[]> {
  return node.get<DiscussionPost[]>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}/posts`,
    { signal },
  )
}

export function openThread(request: OpenThreadRequest): Promise<DiscussionThread> {
  return node.post<DiscussionThread>("/api/v1/discussions", request)
}

export function reply(threadId: string, request: ReplyRequest): Promise<DiscussionPost> {
  return node.post<DiscussionPost>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}/posts`,
    request,
  )
}

export function acceptSolution(threadId: string, postId: string): Promise<DiscussionThread> {
  const request: AcceptSolutionRequest = { post_id: postId }
  return node.post<DiscussionThread>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}/solution`,
    request,
  )
}

export function setThreadStatus(threadId: string, status: string): Promise<DiscussionThread> {
  const request: SetThreadStatusRequest = { status }
  return node.post<DiscussionThread>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}/status`,
    request,
  )
}

/// The caller's own bookmark and nobody else's. The answer is one boolean
/// because there is nothing else to say — no count, no list of who else marked
/// it, because the server never reads this table in aggregate.
export function setBookmark(threadId: string, marked: boolean): Promise<SetBookmarkRequest> {
  const request: SetBookmarkRequest = { marked }
  return node.post<SetBookmarkRequest>(
    `/api/v1/discussions/${encodeURIComponent(threadId)}/bookmark`,
    request,
  )
}

/// A file, fetched through the thread that carries it. As with a conversation
/// attachment, the id in the path is the check and not decoration.
export function discussionAttachmentUrl(threadId: string, fileId: string): string {
  return `/api/v1/discussions/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(fileId)}`
}

/// Live discussions, from the same stream chat uses.
///
/// A discussion has an empty audience on the wire — everybody signed in may
/// read one — so both kinds arrive at every browser. The thread list is
/// refreshed on either; the open thread only on a post that belongs to it.
export function useDiscussionEvents(openThreadId?: string) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const refreshLists = () => {
      void queryClient.invalidateQueries({ queryKey: ["discussions"] })
    }
    const stopThreads = subscribeToCollaboration("discussion.thread", refreshLists)
    const stopPosts = subscribeToCollaboration("discussion.post", (event) => {
      const payload = event.payload as { thread_id?: string } | null
      void queryClient.invalidateQueries({ queryKey: subjectCountsKey() })
      void queryClient.invalidateQueries({ queryKey: ["discussions"], exact: false })
      const threadId = payload?.thread_id
      if (threadId !== undefined && threadId === openThreadId) {
        void queryClient.invalidateQueries({ queryKey: postsKey(threadId) })
        void queryClient.invalidateQueries({ queryKey: threadKey(threadId) })
      }
    })
    return () => {
      stopThreads()
      stopPosts()
    }
  }, [queryClient, openThreadId])
}
