import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { Attachment } from "@/components/collaboration/attachment"
import { LiveBadge } from "@/components/collaboration/live-badge"
import { PersonAvatar } from "@/components/collaboration/person"
import { AttachButton, StagedFiles } from "@/components/collaboration/staged"
import { StatusPill, SubjectChip } from "@/components/discussion/parts"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ago } from "@/lib/collaboration"
import {
  acceptSolution,
  discussionAttachmentUrl,
  postsKey,
  readPosts,
  readThread,
  reply,
  setBookmark,
  setThreadStatus,
  threadKey,
  useDiscussionEvents,
} from "@/lib/discussion"
import { useIdentity } from "@/lib/identity"
import { useStagedUploads } from "@/lib/uploads"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import type { DiscussionPost, DiscussionThread } from "@itulah/contract"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { Bookmark, Check, ChevronLeft, Lock } from "lucide-react"
import { useState } from "react"

/// One discussion, with its answer if it has one.
///
/// Opening this records that this person has seen the thread — one row per
/// person, ever. That is why the number beside it is people and not views, and
/// why it goes up the first time you look and never again.
export function ThreadView() {
  const { threadId } = useParams({ from: "/discussions/$threadId" })
  const queryClient = useQueryClient()
  const identity = useIdentity()
  const me = identity.data?.username
  useDiscussionEvents(threadId)

  const thread = useQuery({
    queryKey: threadKey(threadId),
    queryFn: ({ signal }) => readThread(threadId, signal),
  })
  const posts = useQuery({
    queryKey: postsKey(threadId),
    queryFn: ({ signal }) => readPosts(threadId, signal),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: threadKey(threadId) })
    void queryClient.invalidateQueries({ queryKey: postsKey(threadId) })
    void queryClient.invalidateQueries({ queryKey: ["discussions"] })
  }

  const bookmark = useMutation({
    mutationFn: (marked: boolean) => setBookmark(threadId, marked),
    onSuccess: () => refresh(),
  })
  const status = useMutation({
    mutationFn: (next: string) => setThreadStatus(threadId, next),
    onSuccess: () => refresh(),
  })
  const solution = useMutation({
    mutationFn: (postId: string) => acceptSolution(threadId, postId),
    onSuccess: () => refresh(),
  })

  const record = thread.data

  return (
    <AppShell nav={<Nav />}>
      <ScreenHeader
        title={
          <span className="flex items-center gap-2">
            <Link
              to="/discussions"
              aria-label="Back to discussions"
              className="text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </Link>
            Discussion
          </span>
        }
        subtitle={
          record === undefined
            ? "loading…"
            : `${record.reply_count} ${record.reply_count === 1 ? "reply" : "replies"} · ${record.people} ${record.people === 1 ? "person" : "people"} opened`
        }
      >
        <LiveBadge />
      </ScreenHeader>

      <ScreenBody card={false} className="min-h-0 flex-1 overflow-auto">
        {thread.isPending ? (
          <ScreenState>Loading…</ScreenState>
        ) : thread.isError || record === undefined ? (
          <ScreenState tone="problem">
            {thread.error instanceof ApiError
              ? thread.error.message
              : "That discussion could not be loaded."}
          </ScreenState>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-2.5">
            <ThreadHeader
              thread={record}
              me={me}
              onBookmark={() => bookmark.mutate(!record.bookmarked_by_me)}
              onStatus={(next) => status.mutate(next)}
              busy={bookmark.isPending || status.isPending}
              problem={
                status.error instanceof ApiError
                  ? status.error.message
                  : bookmark.error instanceof ApiError
                    ? bookmark.error.message
                    : null
              }
            />

            {posts.isPending ? (
              <p className="text-muted-foreground p-4 text-center text-xs">Loading replies…</p>
            ) : (
              (posts.data ?? []).map((post) => (
                <Post
                  key={post.post_id}
                  post={post}
                  threadId={threadId}
                  canAccept={
                    record.created_by === me &&
                    record.status === "open" &&
                    post.seq > 1 &&
                    !post.is_solution
                  }
                  onAccept={() => solution.mutate(post.post_id)}
                  accepting={solution.isPending}
                />
              ))
            )}

            {record.status === "locked" ? (
              <div className="text-[var(--os-body,#74747b)] flex items-start gap-2 rounded-[var(--os-r-card,16px)] border border-dashed border-[var(--os-hairline-2,#e4e4e8)] p-3 text-[0.78125rem]">
                <Lock className="mt-0.5 size-4 shrink-0" />
                <span>
                  This discussion is locked, so it takes no new replies. Whatever
                  came next is on the record named in the last reply.
                </span>
              </div>
            ) : (
              <ReplyBox threadId={threadId} me={me} onReplied={refresh} />
            )}
          </div>
        )}
      </ScreenBody>
    </AppShell>
  )
}

function ThreadHeader({
  thread,
  me,
  onBookmark,
  onStatus,
  busy,
  problem,
}: {
  thread: DiscussionThread
  me: string | undefined
  onBookmark: () => void
  onStatus: (status: string) => void
  busy: boolean
  problem: string | null
}) {
  // Only whoever opened a thread may say what answered it or close it — the
  // server enforces that, and offering the buttons to everybody else would be
  // offering a refusal.
  const mine = thread.created_by === me
  return (
    <div className="os-card p-4">
      <h2 className="mb-2 text-[0.9375rem] leading-snug font-semibold tracking-[-0.015em]">
        {thread.title}
      </h2>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill status={thread.status} />
        <SubjectChip kind={thread.subject_kind} subjectId={thread.subject_id} />
        {thread.subject_note !== null && (
          <span className="text-muted-foreground text-[11.5px]">{thread.subject_note}</span>
        )}
        {thread.tags.map((tag) => (
          <span
            key={tag}
            className="text-muted-foreground rounded-full border px-1.5 py-0.5 text-[10px]"
          >
            {tag}
          </span>
        ))}
        <span className="text-muted-foreground ml-auto text-[11px]">
          opened by {thread.created_by} · {ago(thread.created_at)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant={thread.bookmarked_by_me ? "secondary" : "outline"}
          disabled={busy}
          onClick={onBookmark}
        >
          <Bookmark
            className={cn("size-3.5", thread.bookmarked_by_me && "fill-current")}
          />
          {thread.bookmarked_by_me ? "Bookmarked" : "Bookmark"}
        </Button>
        {mine && thread.status !== "resolved" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus("resolved")}>
            Mark answered
          </Button>
        )}
        {mine && thread.status !== "locked" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus("locked")}>
            Lock
          </Button>
        )}
        {mine && thread.status !== "open" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus("open")}>
            Reopen
          </Button>
        )}
        {/* Said out loud because most forums make people assume the opposite. */}
        <span className="text-muted-foreground text-[11px]">
          A bookmark is yours alone — nobody is shown anyone else's.
        </span>
      </div>
      {problem !== null && (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {problem}
        </p>
      )}
    </div>
  )
}

function Post({
  post,
  threadId,
  canAccept,
  onAccept,
  accepting,
}: {
  post: DiscussionPost
  threadId: string
  canAccept: boolean
  onAccept: () => void
  accepting: boolean
}) {
  return (
    <article
      className={cn(
        "os-card overflow-hidden",
        post.is_solution && "border-emerald-500/50",
      )}
    >
      {post.is_solution && (
        <div className="flex items-center gap-2 bg-emerald-500/10 px-4 py-1.5 text-[12px] font-medium text-emerald-600">
          <Check className="size-3.5 shrink-0" />
          Accepted as the answer
        </div>
      )}
      <div className="flex items-center gap-2.5 px-4 pt-3">
        <PersonAvatar username={post.author} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">{post.author}</span>
          <span className="text-muted-foreground block text-[11px]">
            {ago(post.created_at)}
          </span>
        </span>
        <span className="text-muted-foreground font-mono text-[11px]">#{post.seq}</span>
      </div>
      <div className="px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap">
        {post.body}
      </div>
      {post.attachments.length > 0 && (
        <div className="flex flex-col gap-1.5 px-4 pb-3">
          {post.attachments.map((file) => (
            <Attachment
              key={file.file_id}
              file={file}
              href={discussionAttachmentUrl(threadId, file.file_id)}
              className="max-w-none"
            />
          ))}
        </div>
      )}
      {canAccept && (
        <div className="flex items-center justify-end border-t px-4 py-2">
          <Button size="sm" variant="ghost" disabled={accepting} onClick={onAccept}>
            Mark as the answer
          </Button>
        </div>
      )}
    </article>
  )
}

function ReplyBox({
  threadId,
  me,
  onReplied,
}: {
  threadId: string
  me: string | undefined
  onReplied: () => void
}) {
  const [body, setBody] = useState("")
  const uploads = useStagedUploads()

  const post = useMutation({
    mutationFn: () =>
      reply(threadId, {
        body: body.trim(),
        attachments: uploads.ready.map((file) => file.file_id),
        reply_to_seq: null,
        idempotency_key: null,
      }),
    onSuccess: () => {
      setBody("")
      uploads.takeReady()
      onReplied()
    },
  })

  return (
    <div className="os-card flex gap-3 p-3.5">
      {me !== undefined && <PersonAvatar username={me} />}
      <div className="min-w-0 flex-1">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a reply."
          className="min-h-20"
        />
        <StagedFiles staged={uploads.staged} onRemove={uploads.remove} className="mt-2" />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            disabled={body.trim() === "" || post.isPending}
            onClick={() => post.mutate()}
          >
            {post.isPending ? "Posting…" : "Reply"}
          </Button>
          <AttachButton onFiles={uploads.stage} />
          <span className="text-muted-foreground text-[11px]">
            {/* A reply needs words. The schema says so: `body` is checked
                non-empty here, unlike a chat message, because a discussion post
                that is only a file is an argument nobody can follow later. */}
            Files are uploaded first, then named by the reply.
          </span>
        </div>
        {post.isError && (
          <p role="alert" className="text-destructive mt-2 text-xs">
            {post.error instanceof ApiError
              ? post.error.message
              : "The reply could not be posted."}
          </p>
        )}
      </div>
    </div>
  )
}
