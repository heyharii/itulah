import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  Bookmark,
  CheckCheck,
  ChevronDown,
  ChevronsUpDown,
  ListFilter,
  Lock,
  Unlock,
} from "lucide-react"
import { useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { RecordPanel } from "@/components/ui/record-panel"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { ChoiceMenu } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { ButtonGroup, Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
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
import { ago, clock, dayOf, threadTone } from "@/screens/workplace/lib"
import {
  AttachButton,
  AttachmentChips,
  AttachmentLink,
  Avatar,
  Composer,
  VirtualList,
  Voices,
} from "@/screens/workplace/parts"
import type { DiscussionPost, DiscussionThread } from "@itulah/contract"

/// Discussions — arguments about records, kept where the next person finds them.
///
/// Readable by everybody signed in, which is the deliberate difference from a
/// conversation: an argument about a purchase order is a business record, and
/// the person who needs it next week was not in the room. Writing is another
/// matter — only whoever opened a thread may say what answered it or close it,
/// and the controls for those two appear for nobody else.
///
/// # Why this is a forum and not a list of cards with a sheet
///
/// It was both, and the owner asked for neither: "discuss jangan sheet, seperti
/// ini https://discuss.frappe.io/ — page sendiri detailnya". That forum is
/// Discourse, and its shape is not decoration. Two things follow from it:
///
///   * **The list is a table.** Cards were chosen originally because a thread is
///     "something somebody said" rather than a row to compare. But a person
///     scanning a board is comparing — which argument is busiest, which has been
///     read, which moved this morning — and a card puts four rows on a screen
///     where a table puts twenty. Replies, Views and Activity are the three
///     columns every forum has converged on because they are the three
///     questions.
///
///   * **A thread is a page, not a sheet.** A sheet is for something you look at
///     without leaving the list that produced it. An argument with fifteen
///     replies is not that: it is read to the end, linked to, and come back to
///     next week. This follows the same pattern Reports already uses — one
///     screen, two states, which one by a URL parameter — so a thread is a link
///     somebody can send, and every existing `?thread=` link still resolves.

/// Which threads, of everybody's. A scope, and the only thing on this board
/// drawn as tabs — see the note over the toolbar.
const FEEDS = [
  { value: "all", label: "All" },
  { value: "bookmarked", label: "Bookmarked" },
  { value: "mine", label: "Mine" },
] as const

/// What state they are in. `null` is every state, which is the board's
/// resting position and so the menu's first row.
const STATUSES = [
  { value: null, label: "Any status" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Answered" },
  { value: "locked", label: "Locked" },
] as const

type Feed = (typeof FEEDS)[number]["value"]

/// The colour beside a category, the way a forum draws one.
///
/// Assigned by family rather than hashed: nine kinds share five categorical
/// tokens, and which five is a judgement — buying is one colour, who supplies
/// is another, what arrived and what went wrong is a third. A hash would put
/// `receipt` and `article` next to each other in the same colour on a Tuesday
/// and separate them the day a tenth kind is added.
const SUBJECT_DOT: Readonly<Record<string, string>> = {
  purchase_order: "bg-a-blue",
  purchase_order_line: "bg-a-blue",
  supplier: "bg-a-violet",
  supply_item: "bg-a-violet",
  receipt: "bg-a-orange",
  purchase_exception: "bg-a-orange",
  packaging_item: "bg-a-orange",
  commercial_verification: "bg-a-pink",
  article: "bg-a-green",
}

/// One screen, two states. Which thread is open is a URL parameter, so a thread
/// is a link — see the note at the top of this file.
export function Discussions() {
  const open = useSheet("thread")
  return open.value ? (
    <OneThread id={open.value} onBack={open.close} />
  ) : (
    <Board onOpen={open.open} />
  )
}

// ---- The board ---------------------------------------------------------

/// Which column the board is ordered by. `activity` is the server's own order,
/// so choosing it means asking for nothing extra.
type Order = "activity" | "replies" | "views"

function Board({ onOpen }: { onOpen: (id: string) => void }) {
  const [feed, setFeed] = useState<Feed>("all")
  const [status, setStatus] = useState<string | null>(null)
  const [subject, setSubject] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [order, setOrder] = useState<Order>("activity")
  // A blank composer is not a record, so there is nothing to put in the URL:
  // `?thread=` names a thread that exists, and a half-typed one does not.
  const [opening, setOpening] = useState(false)

  // The search goes to the server, so it follows the keystrokes at React's
  // pace rather than at the typist's: one request per pause, not per letter.
  const typed = useDeferredValue(search)

  const filter = useMemo<ThreadFilter>(
    () => ({
      feed: feed === "all" ? undefined : feed,
      status: status ?? undefined,
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

  const filtered =
    feed !== "all" || status !== null || subject !== null || typed.trim() !== ""

  /// Ordered here rather than at the server because the server has one order
  /// and the board offers three. Two hundred rows is the ceiling on this
  /// endpoint, so the whole board is already in memory and sorting it is free —
  /// asking for a second ordering over HTTP would be a round trip to re-arrange
  /// what the browser is holding.
  /// Every tag actually in use, for the rail. Derived from what came back
  /// rather than fetched: there is no tag endpoint on this module, and the
  /// tags worth offering are the ones the visible threads carry.
  const tags = useMemo(
    () =>
      [...new Set((threads.data ?? []).flatMap((row) => row.tags))]
        .sort()
        .slice(0, 12),
    [threads.data]
  )

  const rows = useMemo(() => {
    const list = [...(threads.data ?? [])]
    if (order === "replies") list.sort((a, b) => b.reply_count - a.reply_count)
    if (order === "views") list.sort((a, b) => b.people - a.people)
    return list
  }, [threads.data, order])

  return (
    <PageContent>
      <PageHeader
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
            <Button variant="primary" onClick={() => setOpening(true)}>
              Open a thread
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[12.5rem_minmax(0,1fr)]">
        {/* The forum's own left rail: every category, always visible, with the
            count beside it. A dropdown would hide the one thing this rail is
            for — seeing at a glance where the arguments are. */}
        <Rail
          subjects={subjects}
          selected={subject}
          onSelect={setSubject}
          tags={tags}
          search={search}
          onSearch={setSearch}
        />

        <div className="min-w-0">
          {/* One row of tabs, not two.
              
              There were two segmented controls side by side here — whose
              threads, and what state they are in — drawn identically, so the
              board opened with two tab bars and no way to tell which one
              switched what. They are not the same kind of question. The feed
              is a SCOPE, the three places a person stands on this board, and
              it stays as tabs. The status is a FILTER over whichever scope
              that is, at rest for most readers, and a filter sitting open as
              four pills claims the same rank as the scope above it. Sourcing
              made this exact trade first: four pills became one menu. */}
          <Toolbar className="mb-3">
            <Segmented options={FEEDS} value={feed} onChange={setFeed} />
            <ChoiceMenu
              heading="Show"
              icon={ListFilter}
              value={status}
              options={STATUSES}
              onChange={setStatus}
            />
            <Toolbar.Spacer />
            <span className="text-meta text-body">
              <b className="font-medium text-ink">{count(rows.length)}</b>{" "}
              {filtered
                ? rows.length === 1
                  ? "thread matches"
                  : "threads match"
                : rows.length === 1
                  ? "thread"
                  : "threads"}
            </span>
          </Toolbar>

          {queryState(threads, {
            loading: "Loading the discussions…",
            render: () =>
              rows.length === 0 ? (
                <Card>
                  <EmptyState
                    action={
                      filtered ? (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setFeed("all")
                            setStatus(null)
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
                <Card className="overflow-hidden">
                  <BoardHeader order={order} onOrder={setOrder} />
                  <VirtualList
                    items={rows}
                    estimate={82}
                    getKey={(row) => row.thread_id}
                    className="max-h-[calc(100vh-17rem)]"
                  >
                    {(row) => (
                      <TopicRow
                        thread={row}
                        onOpen={() => onOpen(row.thread_id)}
                      />
                    )}
                  </VirtualList>
                </Card>
              ),
          })}
        </div>
      </div>

      <OpenThreadSheet
        key={subject ?? "any"}
        open={opening}
        onClose={() => setOpening(false)}
        subjectKind={subject}
      />
    </PageContent>
  )
}

/// Categories and tags, down the left.
function Rail({
  subjects,
  selected,
  onSelect,
  tags,
  search,
  onSearch,
}: {
  subjects: ReturnType<
    typeof useQuery<{ subject_kind: string; threads: number }[]>
  >
  selected: string | null
  onSelect: (kind: string | null) => void
  tags: readonly string[]
  search: string
  onSearch: (value: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6 text-nav">
      {/* One list under one heading, which is what "every category" means.
          
          "Topics" used to stand above this block as a button of its own, in
          accent, with an icon nothing else in the rail had — so the loudest
          mark on the page was a row that means NO category chosen. It is not
          a different kind of thing from the rows under it; it is the first of
          them, and it is drawn as the first of them. */}
      <div>
        <h3 className="mb-2 px-2 text-eyebrow font-semibold text-mute uppercase">
          Categories
        </h3>
        {queryState(subjects, {
          loading: "Counting…",
          render: (counts) => (
            <>
              <RailRow
                label="All topics"
                count={counts.reduce((sum, row) => sum + row.threads, 0)}
                selected={selected === null}
                onClick={() => onSelect(null)}
              />
              {counts.length === 0 ? (
                <p className="mt-1 px-2 text-meta text-body">
                  No record has a thread on it yet.
                </p>
              ) : (
                counts.map((row) => (
                  <RailRow
                    key={row.subject_kind}
                    label={subjectLabel(row.subject_kind)}
                    dot={SUBJECT_DOT[row.subject_kind] ?? "bg-line-ico"}
                    count={row.threads}
                    selected={row.subject_kind === selected}
                    onClick={() =>
                      onSelect(
                        selected === row.subject_kind ? null : row.subject_kind
                      )
                    }
                  />
                ))
              )}
            </>
          ),
        })}
      </div>

      {tags.length > 0 && (
        <div>
          <h3 className="mb-2 px-2 text-eyebrow font-semibold text-mute uppercase">
            Tags
          </h3>
          <div className="flex flex-wrap gap-1.5 px-2">
            {tags.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                selected={search === tag}
                // A tag narrows by putting itself in the search box rather than
                // by a filter of its own: the server has no `tag` parameter on
                // this endpoint that the board also exposes, and a chip that
                // silently searched a different field would be a filter that
                // lies about what it did.
                onClick={() => onSearch(search === tag ? "" : tag)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/// A tag, as a word in an outline.
///
/// Not `<Tag>`, which this used: that component is a MONO micro-label for a
/// code — a division, a movement type, `PO-20260902-B492`. These are words
/// somebody typed, `faktur` and `kewenangan`, and setting a word in 10px
/// semibold mono makes a ragged little wall of them that reads as machine
/// output. Same outline grammar as `<Pill>`, at the size of the rest of the
/// rail, so the column has one voice.
function TagChip({
  tag,
  selected = false,
  onClick,
}: {
  tag: string
  selected?: boolean
  onClick?: () => void
}) {
  const skin = cn(
    "inline-flex h-[1.625rem] items-center rounded-full border px-2.5 text-meta whitespace-nowrap transition-colors",
    selected
      ? "border-accent/30 bg-accent-bg font-medium text-accent"
      : "border-hairline-2 bg-canvas text-body"
  )

  if (onClick === undefined) return <span className={skin}>{tag}</span>

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(skin, !selected && "hover:bg-soft-2 hover:text-ink")}
    >
      {tag}
    </button>
  )
}

/// One row of the rail: a mark, a name, and how many threads are under it.
///
/// "All topics" and a category are the same row with and without the colour
/// square, because they are the same act — choosing which slice of the board
/// to read. The blank the square leaves behind is kept so every name in the
/// column starts at one x.
function RailRow({
  label,
  dot,
  count: threads,
  selected,
  onClick,
}: {
  label: string
  dot?: string
  count: number
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-7 w-full items-center gap-2.5 rounded-inner px-2 text-left transition-colors",
        selected
          ? "bg-accent-bg font-medium text-accent"
          : "text-text hover:bg-soft"
      )}
    >
      <span
        className={cn("size-2.5 shrink-0 rounded-[0.1875rem]", dot ?? "")}
      />
      <span className="min-w-0 truncate">{label}</span>
      <span
        className={cn(
          "ml-auto shrink-0 text-meta tabular-nums",
          selected ? "text-accent" : "text-mute"
        )}
      >
        {count(threads)}
      </span>
    </button>
  )
}

/// The grid every row of the board stands on, heading included. One
/// declaration, because a header whose columns drift from its rows is a header
/// that lies about which number is which.
const BOARD_GRID =
  "grid grid-cols-[minmax(0,1fr)_5rem_4rem_4rem_4.5rem] items-center gap-3 px-3.5"

/// The column heads. Replies, Views and Activity are the three every forum
/// converged on, and all three sort.
///
/// Sentence case at the size of the rows, on the tint, one grey lighter —
/// what `<DataTable>` settled on for every other list in the app on
/// 2026-09-10. This board was still shouting 11px uppercase micro-caps at the
/// reader, which put the loudest type on the page above the quietest thing on
/// it, and made the board look like a different app from the twelve screens
/// next door. The sort mark follows the same table: a pale double chevron
/// where the column COULD be sorted, a solid one where it is, and on a
/// right-aligned column it rides in front so the heading stays flush with the
/// figures beneath it.
function BoardHeader({
  order,
  onOrder,
}: {
  order: Order
  onOrder: (order: Order) => void
}) {
  const head = (key: Order, label: string) => (
    <button
      type="button"
      onClick={() => onOrder(key)}
      className={cn(
        "inline-flex flex-row-reverse items-center gap-1 justify-self-end transition-colors hover:text-ink",
        order === key && "text-ink"
      )}
    >
      {order === key ? (
        <ChevronDown className="size-3 text-ink" />
      ) : (
        <ChevronsUpDown className="size-3 text-faint" />
      )}
      {label}
    </button>
  )

  return (
    <div
      className={cn(
        BOARD_GRID,
        "h-10 border-b border-hairline bg-soft text-eyebrow font-medium text-body normal-case"
      )}
    >
      <span>Topic</span>
      <span />
      {head("replies", "Replies")}
      {head("views", "Views")}
      {head("activity", "Activity")}
    </div>
  )
}

/// One row of the board: the title, its category and tags underneath, then the
/// three numbers.
function TopicRow({
  thread,
  onOpen,
}: {
  thread: DiscussionThread
  onOpen: () => void
}) {
  return (
    <div
      onClick={onOpen}
      className={cn(
        BOARD_GRID,
        "cursor-pointer border-b border-hairline py-2.5 transition-colors last:border-b-0 hover:bg-soft"
      )}
    >
      <div className="min-w-0">
        {/* The title wraps rather than truncating. A forum row exists to be
            read, and a board of ellipses is a board nobody can scan — which is
            the one job it has. Two lines is the cap because a third is a
            paragraph. */}
        <div className="flex items-start gap-1.5">
          {thread.bookmarked_by_me && (
            <Bookmark className="mt-[0.1875rem] size-3 shrink-0 fill-accent text-accent" />
          )}
          <span className="line-clamp-2 min-w-0 text-[0.875rem] leading-snug font-medium text-ink">
            {thread.title}
          </span>
          {thread.status !== "open" && (
            <span className="mt-px shrink-0">
              <Pill tone={threadTone(thread.status)}>
                {THREAD_STATUS_LABEL[thread.status] ?? thread.status}
              </Pill>
            </span>
          )}
        </div>
        {/* What the argument is ABOUT, in the order somebody asks it: which
            kind of record, which record, and then the words people filed it
            under. The tags were running straight on from the id in the same
            grey, so a row ended in five words with no telling where the
            record's name stopped and the labels began; a separator is
            cheaper than a chip per tag, which at twenty rows is confetti. */}
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-pill text-mute">
          <span className="flex shrink-0 items-center gap-1.5 text-body">
            <span
              className={cn(
                "size-2 rounded-[0.125rem]",
                SUBJECT_DOT[thread.subject_kind] ?? "bg-line-ico"
              )}
            />
            {subjectLabel(thread.subject_kind)}
          </span>
          <span className="shrink-0 font-mono text-id">
            {thread.subject_id}
          </span>
          {thread.tags.length > 0 && (
            <span aria-hidden className="text-faint">
              ·
            </span>
          )}
          {thread.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>

      <Voices names={thread.voices} />

      <span className="text-right text-meta text-body tabular-nums">
        {count(thread.reply_count)}
      </span>
      <span className="text-right text-meta text-body tabular-nums">
        {count(thread.people)}
      </span>
      <span className="text-right text-pill text-mute">
        {ago(thread.last_activity_at)}
      </span>
    </div>
  )
}

// ---- One thread, on its own page ---------------------------------------

/// The thread, and everything a person may do to it.
///
/// A page rather than a sheet: this is read to the end. The reading column is
/// capped and the meta sits beside it, which is what every forum does and what
/// a 32rem sheet could not.
function OneThread({ id, onBack }: { id: string; onBack: () => void }) {
  const client = useQueryClient()
  const identity = useIdentity()
  const me = identity.data?.username
  const attachments = useAttachments()

  const detail = useQuery({
    queryKey: workplaceKeys.thread(id),
    queryFn: ({ signal }) => readThread(id, signal),
  })

  const posts = useQuery({
    queryKey: workplaceKeys.posts(id),
    queryFn: ({ signal }) => readPosts(id, signal),
  })

  /// Everything below writes to one thread, and every one of them changes the
  /// row this thread shows as on the board — its status, its reply count, its
  /// last activity. So each names the thread's own keys plus the `list` prefix,
  /// which is genuinely everything: the board is keyed by its filter and a
  /// bookmark moves the thread in and out of the "Bookmarked" feed.
  const refreshThread = () => {
    void client.invalidateQueries({ queryKey: workplaceKeys.thread(id) })
    void client.invalidateQueries({
      queryKey: ["workplace", "discussions", "list"],
    })
  }

  const reply = useMutation({
    mutationFn: (body: string) => replyToThread(id, body, attachments.ids),
    onSuccess: () => {
      attachments.clear()
      void client.invalidateQueries({ queryKey: workplaceKeys.posts(id) })
      // A reply with a file on it is a new row on the Files screen.
      void client.invalidateQueries({ queryKey: workplaceKeys.files() })
      refreshThread()
    },
  })

  const bookmark = useMutation({
    mutationFn: (marked: boolean) => setBookmark(id, marked),
    onSuccess: refreshThread,
  })

  const status = useMutation({
    mutationFn: (next: string) => setThreadStatus(id, next),
    onSuccess: () => {
      refreshThread()
      void client.invalidateQueries({ queryKey: workplaceKeys.subjects() })
    },
  })

  const solution = useMutation({
    mutationFn: (postId: string) => acceptSolution(id, postId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: workplaceKeys.posts(id) })
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
    <PageContent>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1.5 text-[0.875rem] font-medium text-mute transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Discussions
      </button>

      {queryState(detail, {
        loading: "Loading the thread…",
        render: (open) => (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
            <div className="min-w-0">
              <h1 className="text-hero font-semibold text-balance text-ink">
                {open.title}
              </h1>

              <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <span className="flex items-center gap-1.5 text-meta text-body">
                  <span
                    className={cn(
                      "size-2.5 rounded-[0.1875rem]",
                      SUBJECT_DOT[open.subject_kind] ?? "bg-line-ico"
                    )}
                  />
                  {subjectLabel(open.subject_kind)}
                </span>
                <span className="font-mono text-id text-mute">
                  {open.subject_id}
                </span>
                {open.tags.map((tag) => (
                  <TagChip key={tag} tag={tag} />
                ))}
                <Pill tone={threadTone(open.status)}>
                  {THREAD_STATUS_LABEL[open.status] ?? open.status}
                </Pill>
                {open.has_solution && (
                  <Pill tone="ok" withDot>
                    Has an accepted answer
                  </Pill>
                )}
              </div>

              {open.subject_note && (
                <p className="mt-1.5 text-meta text-body">
                  {open.subject_note}
                </p>
              )}

              {failure && (
                <Banner tone="bad" className="mt-4">
                  {failure.message}
                </Banner>
              )}
              {attachments.problem && (
                <Banner tone="bad" className="mt-4">
                  {attachments.problem}
                </Banner>
              )}

              <div className="mt-5">
                {queryState(posts, {
                  loading: "Loading the posts…",
                  render: (rows) =>
                    rows.length === 0 ? (
                      <EmptyState>
                        This thread has no opening post, which should not be
                        possible — the server writes one with the thread.
                      </EmptyState>
                    ) : (
                      // Not virtualised, unlike the board. A thread is read
                      // from the top and the page itself scrolls, so an inner
                      // scroller would put a second bar inside the first and
                      // break the one thing a forum page is for.
                      <div>
                        {rows.map((post, index) => (
                          <Post
                            key={post.post_id}
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
                        ))}
                      </div>
                    ),
                })}
              </div>

              <div className="mt-5 border-t border-hairline pt-4">
                <Composer
                  placeholder="Add a reply"
                  rows={3}
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
              </div>
            </div>

            <aside className="flex min-w-0 flex-col gap-4">
              <Button
                variant={open.bookmarked_by_me ? "soft" : "ghost"}
                disabled={bookmark.isPending}
                onClick={() => bookmark.mutate(!open.bookmarked_by_me)}
                className="justify-start gap-1.5"
              >
                <Bookmark
                  className={cn(
                    "size-3.5",
                    open.bookmarked_by_me && "fill-accent text-accent"
                  )}
                />
                {open.bookmarked_by_me ? "Bookmarked" : "Bookmark"}
              </Button>

              <div className="text-[0.875rem]">
                <KeyValue term="Opened by">{open.created_by}</KeyValue>
                <KeyValue term="Replies">{count(open.reply_count)}</KeyValue>
                <KeyValue term="Read it">{count(open.people)}</KeyValue>
                <KeyValue term="Last activity">
                  {ago(open.last_activity_at)}
                </KeyValue>
              </div>

              {/* Only whoever opened a thread may say it is answered or close
                  it, so for everybody else the pill above is the whole story. */}
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

              {/* The record's own log. It came free with `<Sheet subject={…}>`
                  and had to be asked for by name once this stopped being a
                  sheet — a thread that cannot show what was done to it is a
                  thread missing half its history. */}
              <RecordPanel subject={{ kind: "discussion", id }} />
            </aside>
          </div>
        ),
      })}
    </PageContent>
  )
}

/// One post, in the shape a forum draws it: the face in a gutter on the left,
/// who and when on the first line, and the words at full width under them. No
/// box — a card per post turns a conversation into a list of receipts.
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
    <div>
      {showDay && (
        <div className="mb-3 flex items-center gap-2">
          <span className="h-px flex-1 bg-hairline" />
          <span className="text-pill text-mute">{dayOf(post.created_at)}</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>
      )}
      <article
        className={cn(
          "flex gap-3 border-b border-hairline py-4 last:border-b-0",
          post.is_solution && "-mx-3 rounded-inner border-b-0 bg-ok-bg px-3"
        )}
      >
        <Avatar name={post.author} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-meta font-medium text-ink">
              {post.author}
            </span>
            {post.is_solution && (
              <Pill tone="ok" withDot>
                The answer
              </Pill>
            )}
            <span className="ml-auto shrink-0 text-pill text-mute tabular-nums">
              {clock(post.created_at)}
            </span>
          </div>

          <p className="mt-1.5 text-[0.875rem] leading-[1.65] whitespace-pre-wrap text-text">
            {post.body}
          </p>

          {post.attachments.length > 0 && (
            <div className="mt-2.5 flex flex-col gap-1.5">
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
              className="mt-2.5"
              disabled={accepting}
              onClick={onAccept}
            >
              <CheckCheck />
              This answered it
            </Button>
          )}
        </div>
      </article>
    </div>
  )
}

// ---- Opening one -------------------------------------------------------

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
///
/// Still a sheet, and deliberately: a sheet is for something you do without
/// leaving the page that produced it, which is exactly what composing is. It is
/// reading a thread that is not.
function OpenThreadSheet({
  open,
  onClose,
  subjectKind,
}: {
  open: boolean
  onClose: () => void
  /// Prefilled from whatever the board is filtered to, because that is almost
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
      // A new thread changes every filtered view of the board and one of the
      // subject counts, which is the whole left-hand rail of the screen.
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
      width="wide"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-pill text-mute">
            Everybody signed in can read this.
          </span>
          <form.Subscribe selector={(state) => threadReady(state.values)}>
            {(ready) => (
              <Button
                variant="primary"
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
        // Two columns once there is room for them. The pairs are the ones that
        // are read together — what the argument is about and which record it
        // is, then the two optional afterthoughts — and everything a person
        // actually writes into stays the full width of the sheet.
        className="grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-2"
      >
        {create.error instanceof Error && (
          <Banner tone="bad" className="md:col-span-2">
            {create.error.message}
          </Banner>
        )}
        {attachments.problem && (
          <Banner tone="bad" className="md:col-span-2">
            {attachments.problem}
          </Banner>
        )}

        <form.Field name="kind">
          {(field) => (
            <Field label="What it is about">
              <Select
                value={field.state.value}
                onChange={(next) => field.handleChange(next)}
              >
                {SUBJECT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {subjectLabel(kind)}
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
            <Field label="Title" className="md:col-span-2">
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
              className="md:col-span-2"
            >
              <Textarea
                rows={7}
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

        <div className="md:col-span-2">
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
