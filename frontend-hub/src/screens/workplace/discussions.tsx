import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Bookmark,
  CheckCheck,
  Lock,
  MessageSquare,
  MessagesSquare,
  Unlock,
} from "lucide-react"
import { useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardStrip, CardTitle } from "@/components/ui/card"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { ButtonGroup, Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { Timeline, type TimelineEvent } from "@/components/ui/timeline"
import { count } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  SUBJECT_KINDS,
  THREAD_STATUS_LABEL,
  type ThreadFilter,
  acceptSolution,
  discussionAttachmentUrl,
  listThreads,
  openThread,
  readPosts,
  readThread,
  setBookmark,
  setThreadStatus,
  subjectCounts,
  subjectLabel,
  replyToThread,
  workplaceKeys,
} from "@/lib/queries/workplace"
import { useIdentity } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import { useAttachments } from "@/screens/workplace/attachments"
import {
  ago,
  clock,
  dayOf,
  eventSubject,
  threadTone,
} from "@/screens/workplace/lib"
import { useCollaborationFeed } from "@/screens/workplace/live"
import {
  AttachButton,
  AttachmentChips,
  AttachmentLink,
  Avatar,
  Composer,
  VirtualList,
  Voices,
} from "@/screens/workplace/parts"
import type {
  CollaborationEvent,
  DiscussionPost,
  DiscussionThread,
} from "@itulah/contract"

/// Discussions — arguments about records, kept where the next person finds them.
///
/// This is the one family of screens in the app that is deliberately not a
/// table. A thread is not a row to compare against its neighbours; it is
/// something somebody said, and the questions a reader has of it — who is
/// arguing, how long ago, has it been answered — are answered by a record card
/// and not by eight columns. So the list is a stack of cards, virtualised
/// because the server hands over up to two hundred of them, and the detail is
/// the standard `<Sheet>` with the detail composer pinned at its foot.
///
/// Readable by everybody signed in, which is the deliberate difference from a
/// conversation: an argument about a purchase order is a business record, and
/// the person who needs it next week was not in the room. Writing is another
/// matter — only whoever opened a thread may say what answered it or close it,
/// and the controls for those two appear for nobody else.

const FEEDS = [
  { value: "all", label: "All" },
  { value: "bookmarked", label: "Bookmarked" },
  { value: "mine", label: "Mine" },
] as const

const STATUSES = [
  { value: "all", label: "Any" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Answered" },
  { value: "locked", label: "Locked" },
] as const

type Feed = (typeof FEEDS)[number]["value"]
type Status = (typeof STATUSES)[number]["value"]

export function Discussions() {
  const thread = useSheet("thread")
  const [feed, setFeed] = useState<Feed>("all")
  const [status, setStatus] = useState<Status>("all")
  const [subject, setSubject] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  // A blank composer is not a record, so there is nothing to put in the URL:
  // `?thread=` names a thread that exists, and a half-typed one does not.
  const [opening, setOpening] = useState(false)

  // The search goes to the server, so it follows the keystrokes at React's
  // pace rather than at the typist's: one request per pause, not per letter.
  const typed = useDeferredValue(search)

  const filter = useMemo<ThreadFilter>(
    () => ({
      feed: feed === "all" ? undefined : feed,
      status: status === "all" ? undefined : status,
      subjectKind: subject ?? undefined,
      q: typed.trim() === "" ? undefined : typed.trim(),
    }),
    [feed, status, subject, typed]
  )

  const threads = useQuery({
    queryKey: workplaceKeys.threads(filter),
    queryFn: ({ signal }) => listThreads(filter, signal),
  })

  const subjects = useQuery({
    queryKey: workplaceKeys.subjects(),
    queryFn: ({ signal }) => subjectCounts(signal),
  })

  const live = useCollaborationFeed()
  const filtered =
    feed !== "all" ||
    status !== "all" ||
    subject !== null ||
    typed.trim() !== ""

  return (
    <PageContent>
      <PageHeader
        crumb="Workplace"
        title="Discussions"
        sub="Arguments about records, readable by everybody who comes after."
        actions={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            <Button variant="dark" onClick={() => setOpening(true)}>
              Open a thread
            </Button>
          </>
        }
      />

      <Toolbar>
        <Segmented options={FEEDS} value={feed} onChange={setFeed} />
        <Segmented options={STATUSES} value={status} onChange={setStatus} />
        {subject !== null && (
          <Button variant="soft" size="sm" onClick={() => setSubject(null)}>
            {subjectLabel(subject)} ✕
          </Button>
        )}
      </Toolbar>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_17.5rem]">
        <div className="min-w-0">
          {queryState(threads, {
            loading: "Loading the discussions…",
            render: (rows) =>
              rows.length === 0 ? (
                <Card>
                  <EmptyState
                    action={
                      filtered ? (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setFeed("all")
                            setStatus("all")
                            setSubject(null)
                            setSearch("")
                          }}
                        >
                          Clear the filters
                        </Button>
                      ) : undefined
                    }
                  >
                    {filtered
                      ? "No thread matches these filters."
                      : "Nobody has opened a discussion yet."}
                  </EmptyState>
                </Card>
              ) : (
                <VirtualList
                  items={rows}
                  estimate={168}
                  getKey={(row) => row.thread_id}
                  className="max-h-[calc(100vh-16rem)] pr-1"
                >
                  {(row) => (
                    <div className="pb-2.5">
                      <ThreadCard
                        thread={row}
                        selected={row.thread_id === thread.value}
                        onOpen={() => thread.open(row.thread_id)}
                      />
                    </div>
                  )}
                </VirtualList>
              ),
          })}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>By subject</CardTitle>
            </CardHeader>
            <div className="px-4 pb-3.5">
              {queryState(subjects, {
                loading: "Counting…",
                render: (counts) =>
                  counts.length === 0 ? (
                    <p className="text-meta text-body">
                      No record has a thread on it yet.
                    </p>
                  ) : (
                    counts.map((row) => (
                      <button
                        key={row.subject_kind}
                        type="button"
                        onClick={() =>
                          setSubject((current) =>
                            current === row.subject_kind
                              ? null
                              : row.subject_kind
                          )
                        }
                        className={cn(
                          "block w-full rounded-inner px-1.5 text-left transition-colors",
                          row.subject_kind === subject
                            ? "bg-accent-bg"
                            : "hover:bg-soft"
                        )}
                      >
                        <KeyValue term={subjectLabel(row.subject_kind)}>
                          {count(row.threads)}
                        </KeyValue>
                      </button>
                    ))
                  ),
              })}
            </div>
          </Card>

          <ActivityPanel
            events={live.events}
            live={live.live}
            lastEventId={live.lastEventId}
            onOpenThread={(id) => thread.open(id)}
          />
        </div>
      </div>

      {/* Keyed by the record, so a half-written reply and an uploaded
          attachment cannot follow somebody from one thread into the next. */}
      <ThreadSheet
        key={thread.value ?? "closed"}
        id={thread.value ?? null}
        onClose={thread.close}
      />
      <OpenThreadSheet
        key={subject ?? "any"}
        open={opening}
        onClose={() => setOpening(false)}
        subjectKind={subject}
      />
    </PageContent>
  )
}

/// The list unit: a record card, not a table row.
function ThreadCard({
  thread,
  selected,
  onOpen,
}: {
  thread: DiscussionThread
  selected: boolean
  onOpen: () => void
}) {
  return (
    <Card
      className={cn(
        "cursor-pointer overflow-hidden transition-colors",
        selected ? "border-accent" : "hover:border-hairline-strong"
      )}
      onClick={onOpen}
    >
      <CardStrip className={cn(selected && "bg-accent-bg")}>
        <span className="grid size-[1.625rem] shrink-0 place-items-center rounded-inner bg-canvas text-line-ico">
          <MessagesSquare className="size-3.5" />
        </span>
        <Tag>{subjectLabel(thread.subject_kind)}</Tag>
        <span className="min-w-0 truncate font-mono text-id text-body">
          {thread.subject_id}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {thread.bookmarked_by_me && (
            <Bookmark className="size-3.5 text-accent" />
          )}
          <Pill tone={threadTone(thread.status)}>
            {THREAD_STATUS_LABEL[thread.status] ?? thread.status}
          </Pill>
        </span>
      </CardStrip>

      <div className="px-4 py-3">
        <h3 className="text-card-title font-medium text-ink">{thread.title}</h3>
        {thread.subject_note && (
          <p className="mt-0.5 text-pill text-mute">{thread.subject_note}</p>
        )}
        {thread.latest_post_preview && (
          <p className="mt-1.5 line-clamp-2 text-meta text-body">
            {thread.latest_post_preview}
          </p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Voices names={thread.voices} />
          <span className="text-pill text-mute tabular-nums">
            {count(thread.reply_count)} replies · {count(thread.people)} read it
          </span>
          {thread.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
          <span className="ml-auto text-pill text-mute">
            {ago(thread.last_activity_at)}
          </span>
        </div>
      </div>
    </Card>
  )
}

/// What has happened since this browser caught up with the log.
///
/// The stream endpoint is not the one this module was given, so it follows
/// `GET /chat/events` instead — the identical query behind the SSE route, asked
/// on a timer. The lag is stated rather than hidden: a green dot that says
/// "fine" while a browser is a hundred events behind is a lie, so the panel
/// says which it is.
function ActivityPanel({
  events,
  live,
  lastEventId,
  onOpenThread,
}: {
  events: readonly CollaborationEvent[]
  live: boolean
  lastEventId: number
  onOpenThread: (threadId: string) => void
}) {
  const items = useMemo<TimelineEvent[]>(
    () =>
      events.map((event, index) => {
        const subject = eventSubject(event.payload)
        const kind =
          event.kind === "chat.message"
            ? "Message"
            : event.kind === "discussion.thread"
              ? "Thread opened"
              : event.kind === "discussion.post"
                ? "Reply"
                : event.kind === "chat.read"
                  ? "Read"
                  : "Notification"
        return {
          id: String(event.event_id),
          title: subject.title ?? kind,
          detail: subject.author ? `By ${subject.author}` : kind,
          at: clock(event.occurred_at),
          state: index === 0 ? "current" : "done",
          icon: <MessageSquare className="size-3" />,
        }
      }),
    [events]
  )

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <span className="font-mono text-[0.625rem] text-mute tabular-nums">
          #{lastEventId}
        </span>
      </CardHeader>
      <div className="px-4 pb-3.5">
        {!live ? (
          <p className="text-meta text-body">
            Catching up with the log — nothing here is news yet.
          </p>
        ) : items.length === 0 ? (
          <p className="text-meta text-body">
            Following. Nothing has happened since this page opened.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Timeline
              events={items.map((item, index) => ({
                ...item,
                title: (
                  <button
                    type="button"
                    className="text-left hover:text-accent"
                    onClick={() => {
                      const threadId = eventSubject(
                        events[index].payload
                      ).threadId
                      if (threadId !== undefined) onOpenThread(threadId)
                    }}
                  >
                    {item.title}
                  </button>
                ),
              }))}
            />
          </div>
        )}
      </div>
    </Card>
  )
}

/// The thread, and everything a person may do to it.
function ThreadSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const identity = useIdentity()
  const me = identity.data?.username
  const attachments = useAttachments()

  const detail = useQuery({
    queryKey: workplaceKeys.thread(id ?? ""),
    queryFn: ({ signal }) => readThread(id!, signal),
    enabled: id !== null,
  })

  const posts = useQuery({
    queryKey: workplaceKeys.posts(id ?? ""),
    queryFn: ({ signal }) => readPosts(id!, signal),
    enabled: id !== null,
  })

  /// Everything below writes to one thread, and every one of them changes the
  /// row this thread shows as in the list — its status, its reply count, its
  /// last activity. So each names the thread's own keys plus the `list` prefix,
  /// which is genuinely everything: the list is keyed by its filter and a
  /// bookmark moves the thread in and out of the "Bookmarked" feed.
  const refreshThread = () => {
    if (id === null) return
    void client.invalidateQueries({ queryKey: workplaceKeys.thread(id) })
    void client.invalidateQueries({
      queryKey: ["workplace", "discussions", "list"],
    })
  }

  const reply = useMutation({
    mutationFn: (body: string) => replyToThread(id!, body, attachments.ids),
    onSuccess: () => {
      attachments.clear()
      void client.invalidateQueries({ queryKey: workplaceKeys.posts(id!) })
      // A reply with a file on it is a new row on the Files screen.
      void client.invalidateQueries({ queryKey: workplaceKeys.files() })
      refreshThread()
    },
  })

  const bookmark = useMutation({
    mutationFn: (marked: boolean) => setBookmark(id!, marked),
    onSuccess: refreshThread,
  })

  const status = useMutation({
    mutationFn: (next: string) => setThreadStatus(id!, next),
    onSuccess: () => {
      refreshThread()
      void client.invalidateQueries({ queryKey: workplaceKeys.subjects() })
    },
  })

  const solution = useMutation({
    mutationFn: (postId: string) => acceptSolution(id!, postId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: workplaceKeys.posts(id!) })
      refreshThread()
    },
  })

  const thread = detail.data
  const mine = thread !== undefined && me === thread.created_by
  const locked = thread?.status === "locked"

  const failure = [
    reply.error,
    bookmark.error,
    status.error,
    solution.error,
  ].find((error): error is Error => error instanceof Error)

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "discussion", id }}
      onOpenChange={(open) => !open && onClose()}
      className="w-[32.5rem]"
      id={
        thread
          ? `${subjectLabel(thread.subject_kind)} · ${thread.subject_id}`
          : undefined
      }
      title={thread?.title ?? "Thread"}
      actions={
        thread && (
          <Button
            variant="quiet"
            size="icon"
            aria-label={
              thread.bookmarked_by_me ? "Remove bookmark" : "Bookmark this"
            }
            disabled={bookmark.isPending}
            onClick={() => bookmark.mutate(!thread.bookmarked_by_me)}
          >
            <Bookmark
              className={cn(
                thread.bookmarked_by_me && "fill-accent text-accent"
              )}
            />
          </Button>
        )
      }
      footer={
        id !== null && (
          <Composer
            placeholder="Add a reply"
            rows={2}
            busy={reply.isPending}
            uploading={attachments.uploading}
            disabled={locked}
            disabledReason={
              locked
                ? "This thread is locked. Nobody can reply to it."
                : undefined
            }
            attachments={attachments.pending}
            onAttach={attachments.add}
            onRemoveAttachment={attachments.remove}
            onSend={(body) => reply.mutate(body)}
          />
        )
      }
    >
      {queryState(detail, {
        loading: "Loading the thread…",
        render: (open) => (
          <div className="flex h-full min-h-0 flex-col gap-4">
            {failure && <Banner tone="bad">{failure.message}</Banner>}
            {attachments.problem && (
              <Banner tone="bad">{attachments.problem}</Banner>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={threadTone(open.status)}>
                {THREAD_STATUS_LABEL[open.status] ?? open.status}
              </Pill>
              {open.has_solution && (
                <Pill tone="ok" withDot>
                  Has an accepted answer
                </Pill>
              )}
              {open.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>

            <Facts>
              <Fact term="Subject">{subjectLabel(open.subject_kind)}</Fact>
              <Fact term="Record">{open.subject_id}</Fact>
              <Fact term="Opened by">{open.created_by}</Fact>
              <Fact term="Last activity">{ago(open.last_activity_at)}</Fact>
              <Fact term="Replies">{count(open.reply_count)}</Fact>
              <Fact term="People who read it">{count(open.people)}</Fact>
            </Facts>

            {open.subject_note && (
              <p className="text-meta text-body">{open.subject_note}</p>
            )}

            {/* Only whoever opened a thread may say it is answered or close it,
                so for everybody else the pill above is the whole story. */}
            {mine && (
              <div>
                <h4 className="mb-1.5 text-eyebrow font-semibold text-mute uppercase">
                  Set the status
                </h4>
                <ButtonGroup>
                  <button
                    type="button"
                    disabled={status.isPending || open.status === "open"}
                    onClick={() => status.mutate("open")}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    disabled={status.isPending || open.status === "resolved"}
                    onClick={() => status.mutate("resolved")}
                  >
                    <CheckCheck className="mr-1 inline size-3.5" />
                    Answered
                  </button>
                  <button
                    type="button"
                    disabled={status.isPending || open.status === "locked"}
                    onClick={() => status.mutate("locked")}
                  >
                    {locked ? (
                      <Unlock className="mr-1 inline size-3.5" />
                    ) : (
                      <Lock className="mr-1 inline size-3.5" />
                    )}
                    Locked
                  </button>
                </ButtonGroup>
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col">
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                The argument
              </h4>
              {queryState(posts, {
                loading: "Loading the posts…",
                render: (rows) =>
                  rows.length === 0 ? (
                    <EmptyState>
                      This thread has no opening post, which should not be
                      possible — the server writes one with the thread.
                    </EmptyState>
                  ) : (
                    <VirtualList
                      items={rows}
                      estimate={124}
                      getKey={(post) => post.post_id}
                      className="min-h-40 flex-1"
                    >
                      {(post, index) => (
                        <Post
                          post={post}
                          threadId={open.thread_id}
                          showDay={
                            index === 0 ||
                            dayOf(rows[index - 1].created_at) !==
                              dayOf(post.created_at)
                          }
                          canAccept={mine && index > 0 && !post.is_solution}
                          accepting={solution.isPending}
                          onAccept={() => solution.mutate(post.post_id)}
                        />
                      )}
                    </VirtualList>
                  ),
              })}
            </div>
          </div>
        ),
      })}
    </Sheet>
  )
}

function Post({
  post,
  threadId,
  showDay,
  canAccept,
  accepting,
  onAccept,
}: {
  post: DiscussionPost
  threadId: string
  showDay: boolean
  canAccept: boolean
  accepting: boolean
  onAccept: () => void
}) {
  return (
    <div className="pb-3">
      {showDay && (
        <div className="mb-2 flex items-center gap-2">
          <span className="h-px flex-1 bg-hairline" />
          <span className="text-pill text-mute">{dayOf(post.created_at)}</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>
      )}
      <div
        className={cn(
          "rounded-inner border p-3",
          post.is_solution ? "border-ok-bg bg-ok-bg" : "border-hairline"
        )}
      >
        <div className="flex items-center gap-2">
          <Avatar name={post.author} size="sm" />
          <span className="text-meta font-medium text-ink">{post.author}</span>
          {post.is_solution && (
            <Pill tone="ok" withDot>
              The answer
            </Pill>
          )}
          <span className="ml-auto shrink-0 text-pill text-mute tabular-nums">
            {clock(post.created_at)}
          </span>
        </div>

        <p className="mt-1.5 text-[0.84375rem] leading-relaxed whitespace-pre-wrap text-text">
          {post.body}
        </p>

        {post.attachments.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {post.attachments.map((file) => (
              <AttachmentLink
                key={file.file_id}
                name={file.file_name}
                size={file.byte_size}
                available={file.available}
                href={discussionAttachmentUrl(threadId, file.file_id)}
              />
            ))}
          </div>
        )}

        {canAccept && (
          <Button
            variant="soft"
            size="sm"
            className="mt-2"
            disabled={accepting}
            onClick={onAccept}
          >
            <CheckCheck />
            This answered it
          </Button>
        )}
      </div>
    </div>
  )
}

interface ThreadDraft {
  kind: string
  recordId: string
  title: string
  body: string
  note: string
  tags: string
}

/// The record it hangs on, what it is called, and the argument itself. A thread
/// missing the last of those is a title.
function threadReady(draft: ThreadDraft): boolean {
  return (
    draft.recordId.trim() !== "" &&
    draft.title.trim() !== "" &&
    draft.body.trim() !== ""
  )
}

/// Opening a thread. Every field the server asks for, and no field it does not.
function OpenThreadSheet({
  open,
  onClose,
  subjectKind,
}: {
  open: boolean
  onClose: () => void
  /// Prefilled from whatever the list is filtered to, because that is almost
  /// always what somebody is about to argue about.
  subjectKind: string | null
}) {
  const client = useQueryClient()
  // The files are uploaded before the thread exists, so they are the upload
  // hook's state rather than the form's: the form holds what is typed.
  const attachments = useAttachments()

  const create = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: ThreadDraft) =>
      openThread({
        subject_kind: draft.kind,
        subject_id: draft.recordId.trim(),
        subject_note: draft.note.trim() === "" ? null : draft.note.trim(),
        title: draft.title.trim(),
        body: draft.body.trim(),
        tags: draft.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag !== ""),
        attachments: attachments.ids,
      }),
    onSuccess: () => {
      // A new thread changes every filtered view of the list and one of the
      // subject counts, which is the whole left-hand axis of the screen.
      void client.invalidateQueries({
        queryKey: ["workplace", "discussions", "list"],
      })
      void client.invalidateQueries({ queryKey: workplaceKeys.subjects() })
      attachments.clear()
      // Everything but the subject kind, which is where the next argument is
      // most likely to be about too.
      form.setFieldValue("recordId", "")
      form.setFieldValue("title", "")
      form.setFieldValue("body", "")
      form.setFieldValue("note", "")
      form.setFieldValue("tags", "")
      onClose()
    },
  })

  const form = useForm({
    defaultValues: {
      kind: subjectKind ?? SUBJECT_KINDS[0],
      recordId: "",
      title: "",
      body: "",
      note: "",
      tags: "",
    } as ThreadDraft,
    onSubmit: ({ value }) => create.mutate(value),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Open a thread"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-pill text-mute">
            Everybody signed in can read this.
          </span>
          <form.Subscribe selector={(state) => threadReady(state.values)}>
            {(ready) => (
              <Button
                variant="dark"
                disabled={!ready || create.isPending}
                onClick={() => form.handleSubmit()}
              >
                {create.isPending ? "Opening…" : "Open it"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      }
    >
      <form
        // The button is in the sheet's footer, outside this element, so its
        // disabled state cannot block an Enter keypress.
        onSubmit={(event) => {
          event.preventDefault()
          if (threadReady(form.state.values) && !create.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-4"
      >
        {create.error instanceof Error && (
          <Banner tone="bad">{create.error.message}</Banner>
        )}
        {attachments.problem && (
          <Banner tone="bad">{attachments.problem}</Banner>
        )}

        <form.Field name="kind">
          {(field) => (
            <Field
              label="What is it about"
              hint="A thread hangs on a record. One that does not is a conversation, and there is a screen for those."
            >
              <Select
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              >
                {SUBJECT_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {subjectLabel(option)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </form.Field>

        <form.Field name="recordId">
          {(field) => (
            <Field
              label="Which one"
              hint="The record's own identifier — PO-2607-0108."
            >
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="PO-2607-0108"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="title">
          {(field) => (
            <Field label="Title">
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="Short enough to read in a list"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="body">
          {(field) => (
            <Field
              label="The opening post"
              hint="A thread with no opening argument is a title."
            >
              <Textarea
                rows={5}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="note">
          {(field) => (
            <Field
              label="Note"
              hint="Optional. What the record is, for a reader who has not opened it."
            >
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="tags">
          {(field) => (
            <Field label="Tags" hint="Comma separated.">
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <div>
          <h4 className="mb-1.5 text-eyebrow font-semibold text-mute uppercase">
            Attachments
          </h4>
          <div className="flex items-center gap-2">
            <AttachButton
              onAttach={attachments.add}
              disabled={attachments.uploading}
            />
            {attachments.pending.length === 0 ? (
              <span className="text-meta text-mute">
                {attachments.uploading ? "Uploading…" : "Optional."}
              </span>
            ) : (
              <AttachmentChips
                attachments={attachments.pending}
                onRemove={attachments.remove}
              />
            )}
          </div>
        </div>
      </form>
    </Sheet>
  )
}
