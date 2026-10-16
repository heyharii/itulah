import { POP_MOTION } from "@/lib/filter-chrome"
import { Menu } from "@base-ui/react/menu"
import { useForm } from "@tanstack/react-form"
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Bookmark,
  CheckCheck,
  ChevronDown,
  ChevronsUpDown,
  CornerUpLeft,
  History,
  Link2,
  ListFilter,
  Lock,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  SmilePlus,
  Trash2,
  Unlock,
  X,
} from "lucide-react"
import {
  Fragment,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, Panel } from "@/components/ui/dialog"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Select } from "@/components/ui/field"
import { ChoiceMenu } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { RecordPanel } from "@/components/ui/record-panel"
import { KeyValue } from "@/components/ui/rows"
import { ButtonGroup, Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/states"
import { count, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { queryState } from "@/lib/query-state"
import {
  REACTIONS,
  SUBSCRIPTION_LEVELS,
  THREAD_PAGE,
  THREAD_STATUS_LABEL,
  type ThreadFeed,
  type ThreadFilter,
  type ThreadOrder,
  acceptSolution,
  discussionAttachmentUrl,
  discussionPeople,
  dismissUnread,
  editPost,
  editThread,
  listThreads,
  openThread,
  postRevisions,
  reactToPost,
  reactionEmoji,
  readPosts,
  readThread,
  replyToThread,
  setBookmark,
  setPin,
  setSubscription,
  setThreadStatus,
  subjectCounts,
  subjectKinds,
  tagCounts,
  withdrawPost,
  workplaceKeys,
} from "@/lib/queries/workplace"
import { recordRoute } from "@/lib/record-route"
import { useIdentity } from "@/lib/session"
import { useSheet, type SheetSearch } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import {
  CardFigure,
  type CardSpec,
  DESK_BAR,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { FilterSheet } from "@/components/ui/filter-sheet"
import { useAttachments } from "@/screens/workplace/attachments"
import {
  ago,
  clock,
  dayOf,
  idempotencyKey,
  threadTone,
} from "@/screens/workplace/lib"
import { useCollaborationFeed } from "@/screens/workplace/live"
import { Markdown } from "@/screens/workplace/markdown"
import {
  AttachmentLink,
  Avatar,
  VirtualList,
  Voices,
} from "@/screens/workplace/parts"
import { PostEditor, type Mentionable } from "@/screens/workplace/post-editor"
import type {
  DiscussionPost,
  DiscussionThread,
  PostReaction,
  SubjectCount,
  TagCount,
} from "@itulah/contract"

/// Discussions — arguments about records, kept where the next person finds them.
///
/// Readable by everybody signed in, which is the deliberate difference from a
/// conversation: an argument about a purchase order is a business record, and
/// the person who needs it next week was not in the room. Writing is another
/// matter — only whoever opened a thread may say what answered it or close it,
/// only whoever wrote a post may correct it, and head office moderates. The
/// server says which of those the reader may do (`can_manage`, `can_edit`, …)
/// and the controls follow it rather than re-deriving the rule here.
///
/// # Why this is a forum and not a list of cards with a sheet
///
/// It was both, and the owner asked for neither: "discuss jangan sheet, seperti
/// ini https://discuss.frappe.io/ — page sendiri detailnya". That forum is
/// Discourse, and its shape is not decoration. Three things follow from it:
///
///   * **The list is a table.** A person scanning a board is comparing — which
///     argument is busiest, which has been read, which moved this morning — and
///     a card puts four rows on a screen where a table puts twenty. Replies,
///     Views and Activity are the three columns every forum has converged on
///     because they are the three questions.
///
///   * **A thread is a page, not a sheet.** An argument with fifteen replies is
///     read to the end, linked to, and come back to next week. One screen, two
///     states, which one by a URL parameter — so a thread is a link somebody
///     can send, and every existing `?thread=` link still resolves. A single
///     post is a link too: `#post-7`.
///
///   * **It remembers where you were.** Unread and New on the board, "new since
///     your last visit" in the thread, and the page opens at the first post you
///     have not read. That is the part of Discourse that makes a busy forum
///     readable, and it is a position on the server, not a guess in the tab.

/// Which threads, of everybody's. A scope, and the only thing on this board
/// drawn as tabs — see the note over the toolbar.
const FEEDS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "new", label: "New" },
  { value: "mine", label: "Mine" },
  { value: "bookmarked", label: "Bookmarked" },
  { value: "watching", label: "Watching" },
] as const

type Feed = (typeof FEEDS)[number]["value"]

/// What state they are in. `null` is every state, which is the board's
/// resting position and so the menu's first row.
const STATUSES = [
  { value: null, label: "Any status" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Answered" },
  { value: "locked", label: "Locked" },
] as const

/// The colour beside a category, the way a forum draws one.
///
/// Assigned by family rather than hashed: kinds share five categorical tokens,
/// and which five is a judgement — buying is one colour, who supplies is
/// another, what arrived and what went wrong is a third. A kind not named here
/// is drawn in the neutral mark rather than a colour a hash picked for it.
const SUBJECT_DOT: Readonly<Record<string, string>> = {
  purchase_order: "bg-a-blue",
  purchase_order_line: "bg-a-blue",
  purchase_price_amendment: "bg-a-blue",
  supplier: "bg-a-violet",
  supplier_item: "bg-a-violet",
  supply_item: "bg-a-violet",
  receipt: "bg-a-orange",
  purchase_exception: "bg-a-orange",
  packaging_item: "bg-a-orange",
  asset: "bg-a-orange",
  maintenance_task: "bg-a-orange",
  repair: "bg-a-orange",
  commercial_verification: "bg-a-pink",
  campaign: "bg-a-pink",
  commercial_rule: "bg-a-pink",
  article: "bg-a-green",
  bill: "bg-a-green",
  payment: "bg-a-green",
}

function dotOf(kind: string): string {
  return SUBJECT_DOT[kind] ?? "bg-line-ico"
}

/// One screen, two states. Which thread is open is a URL parameter, so a thread
/// is a link — see the note at the top of this file.
export function Discussions() {
  // Live: a reply, an edit or a reaction written anywhere reaches this screen
  // within a few seconds. The feed was mounted on Chat only, so a thread open
  // here stayed as it was until somebody reloaded it.
  useCollaborationFeed()
  const open = useSheet("thread")
  const people = usePeople()
  return open.value ? (
    // Keyed, so walking from one thread to another starts the second one
    // fresh — its draft, its reading position, its open editor.
    <OneThread
      key={open.value}
      id={open.value}
      onBack={open.close}
      people={people}
    />
  ) : (
    <Board onOpen={open.open} people={people} />
  )
}

/// Everybody who can be named with `@`, for the composer.
///
/// Fetched once and kept: the account list moves when somebody joins, not
/// while a reply is being written. A failure is not shown — naming people is
/// an aid, and the server still reads a typed `@name` without it.
function usePeople(): readonly Mentionable[] {
  const people = useQuery({
    queryKey: workplaceKeys.people(),
    queryFn: ({ signal }) => discussionPeople(signal),
    staleTime: 5 * 60_000,
  })
  return people.data ?? NOBODY
}

/// One empty list, so a screen still waiting on the people does not hand the
/// composer a new array on every render.
const NOBODY: readonly Mentionable[] = []

/// Every write that moves a row on the board, in one place.
function refreshBoard(client: QueryClient) {
  void client.invalidateQueries({
    queryKey: ["workplace", "discussions", "list"],
  })
  void client.invalidateQueries({ queryKey: workplaceKeys.subjects() })
  void client.invalidateQueries({ queryKey: workplaceKeys.tags() })
}

// ---- The board ---------------------------------------------------------

function Board({
  onOpen,
  people,
}: {
  onOpen: (id: string) => void
  people: readonly Mentionable[]
}) {
  const navigate = useNavigate()
  const about = useSheet("about")
  const aboutId = useSheet("aboutId")
  const subject = about.value ?? null
  const subjectId = aboutId.value ?? null

  const [feed, setFeed] = useState<Feed>("all")
  const [status, setStatus] = useState<string | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [order, setOrder] = useState<ThreadOrder>("activity")
  // A blank composer is not a record, so there is nothing to put in the URL:
  // `?thread=` names a thread that exists, and a half-typed one does not.
  const [opening, setOpening] = useState(false)
  const [filtering, setFiltering] = useState(false)
  const phone = useLayout() === "phone"
  const me = useIdentity().data?.username

  // The search goes to the server, so it follows the keystrokes at React's
  // pace rather than at the typist's: one request per pause, not per letter.
  const typed = useDeferredValue(search)

  /// The record the board is narrowed to lives in the URL, so "3 discussions"
  /// on a purchase order's sheet is a link that lands here already narrowed.
  /// Choosing a category replaces it: a category is a kind of record, and the
  /// one record chosen before it is no longer the question.
  const setSubject = (kind: string | null) =>
    navigate({
      to: ".",
      replace: true,
      search: (prev: SheetSearch) => ({
        ...prev,
        about: kind ?? undefined,
        aboutId: undefined,
      }),
      viewTransition: false,
    })

  const clearRecord = () =>
    navigate({
      to: ".",
      replace: true,
      search: (prev: SheetSearch) => ({ ...prev, aboutId: undefined }),
      viewTransition: false,
    })

  const filter = useMemo<ThreadFilter>(
    () => ({
      feed: feed === "all" ? undefined : (feed as ThreadFeed),
      status: status ?? undefined,
      subjectKind: subject ?? undefined,
      subjectId: subjectId ?? undefined,
      tag: tag ?? undefined,
      q: typed.trim() === "" ? undefined : typed.trim(),
      order,
    }),
    [feed, status, subject, subjectId, tag, typed, order]
  )

  const threads = useInfiniteQuery({
    queryKey: workplaceKeys.threadPages(filter),
    queryFn: ({ pageParam, signal }) =>
      listThreads({ ...filter, limit: THREAD_PAGE, offset: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.length < THREAD_PAGE ? undefined : pages.length * THREAD_PAGE,
    // Another feed or filter: the threads in hand stay, dimmed (`list-swap`),
    // until the next are read.
    placeholderData: keepPreviousData,
  })

  const subjects = useQuery({
    queryKey: workplaceKeys.subjects(),
    queryFn: ({ signal }) => subjectCounts(signal),
  })

  const tags = useQuery({
    queryKey: workplaceKeys.tags(),
    queryFn: ({ signal }) => tagCounts(signal),
  })

  /// The pages, joined, each thread once. A page is an offset into a list
  /// that moves — a reply lifts a thread to the top while page two is on its
  /// way — so the same thread can arrive twice, and it is drawn once.
  const rows = useMemo(() => {
    const seen = new Set<string>()
    const out: DiscussionThread[] = []
    for (const thread of threads.data?.pages.flat() ?? []) {
      if (seen.has(thread.thread_id)) continue
      seen.add(thread.thread_id)
      out.push(thread)
    }
    return out
  }, [threads.data])

  const filtered =
    feed !== "all" ||
    status !== null ||
    subject !== null ||
    subjectId !== null ||
    tag !== null ||
    typed.trim() !== ""

  const client = useQueryClient()
  const dismiss = useMutation({
    mutationFn: () => dismissUnread(),
    onSuccess: ({ threads: caught }) => {
      refreshBoard(client)
      toast.success(
        caught === 1
          ? "One thread marked as read"
          : `${count(caught)} threads marked as read`
      )
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const clear = () => {
    setFeed("all")
    setStatus(null)
    setTag(null)
    setSearch("")
    void setSubject(null)
  }

  return (
    <PageContent>
      <PageHeader
        title="Discussions"
        sub="Arguments about records, readable by everybody who comes after."
        actions={
          // On a phone the search, the scope, the filters and the order are the
          // dock's, and the one thing this page makes is its round button.
          phone ? undefined : (
            <>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search"
                className="h-8 w-56"
              />
              <Button variant="primary" onClick={() => setOpening(true)}>
                Open a thread
              </Button>
            </>
          )
        }
      />

      <Fab label="Open a thread" onClick={() => setOpening(true)} />
      <DockTools
        search={{
          value: search,
          onChange: setSearch,
          label: "Search discussions",
        }}
        filter={{
          count:
            (status === null ? 0 : 1) +
            (subject === null ? 0 : 1) +
            (subjectId === null ? 0 : 1) +
            (tag === null ? 0 : 1),
          onOpen: () => setFiltering(true),
        }}
        sort={{
          label: "Order",
          choices: {
            options: [
              { value: "created", label: "Newest" },
              { value: "replies", label: "Replies" },
              { value: "views", label: "Views" },
              { value: "activity", label: "Activity" },
            ],
            value: order,
            desc: true,
            onChange: (next) => setOrder((next || "activity") as ThreadOrder),
          },
        }}
        status={{
          value: feed,
          options: FEEDS.map((one) => ({ value: one.value, label: one.label })),
          onChange: (next) => setFeed(next as Feed),
        }}
      />
      <FilterSheet
        open={filtering}
        onOpenChange={setFiltering}
        groups={[
          {
            key: "status",
            label: "Show",
            value: status,
            options: STATUSES.map((one) => ({
              value: one.value as string | null,
              label: one.label,
            })),
            onChange: setStatus,
          },
          {
            key: "category",
            label: "Category",
            value: subject,
            options: [
              {
                value: null,
                label: "All topics",
                count: (subjects.data ?? []).reduce(
                  (sum, row) => sum + row.threads,
                  0
                ),
              },
              ...(subjects.data ?? []).map((row) => ({
                value: row.subject_kind as string | null,
                label: row.label,
                count: row.threads,
              })),
            ],
            onChange: (next) => void setSubject(next),
          },
          ...((tags.data ?? []).length === 0
            ? []
            : [
                {
                  key: "tag",
                  label: "Tag",
                  value: tag,
                  options: [
                    { value: null as string | null, label: "Any tag" },
                    ...(tags.data ?? []).slice(0, 24).map((row) => ({
                      value: row.tag as string | null,
                      label: row.tag,
                      count: row.threads,
                    })),
                  ],
                  onChange: setTag,
                },
              ]),
          ...(subjectId === null
            ? []
            : [
                {
                  key: "record",
                  label: "About",
                  value: subjectId as string | null,
                  options: [
                    { value: null as string | null, label: "Any record" },
                    { value: subjectId as string | null, label: subjectId },
                  ],
                  onChange: () => void clearRecord(),
                },
              ]),
        ]}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[12.5rem_minmax(0,1fr)]">
        {/* The forum's own left rail: every category, always visible, with the
            count beside it. A dropdown would hide the one thing this rail is
            for — seeing at a glance where the arguments are. */}
        <div className="contents max-md:hidden">
          <Rail
            subjects={subjects}
            selected={subject}
            onSelect={(kind) => void setSubject(kind)}
            tags={tags}
            tag={tag}
            onTag={setTag}
          />
        </div>

        <div className="min-w-0">
          {/* One row of tabs, not two.

              The feed is a SCOPE — where a person stands on this board — and
              it is tabs. The status is a FILTER over whichever scope that is,
              at rest for most readers, and a filter sitting open as four pills
              claims the same rank as the scope above it. So it is one menu. */}
          <div className={cn(DESK_BAR, "mb-3")}>
            <Segmented options={FEEDS} value={feed} onChange={setFeed} />
            <ChoiceMenu
              heading="Show"
              icon={ListFilter}
              value={status}
              options={STATUSES}
              onChange={setStatus}
            />
            <Toolbar.Spacer />
            {feed === "unread" && rows.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                pending={dismiss.isPending}
                onClick={() => dismiss.mutate()}
              >
                <CheckCheck />
                Mark all read
              </Button>
            )}
            <span className="text-meta text-body">
              <b className="font-medium text-ink">
                {count(rows.length)}
                {threads.hasNextPage ? "+" : ""}
              </b>{" "}
              {filtered
                ? rows.length === 1
                  ? "thread matches"
                  : "threads match"
                : rows.length === 1
                  ? "thread"
                  : "threads"}
            </span>
          </div>

          {/* On a phone the toolbar is the dock's, and what is left of it is the
              one sentence that says how many. */}
          <p className="mb-3 text-meta text-body md:hidden">
            <b className="font-medium text-ink">
              {count(rows.length)}
              {threads.hasNextPage ? "+" : ""}
            </b>{" "}
            {filtered
              ? rows.length === 1
                ? "thread matches"
                : "threads match"
              : rows.length === 1
                ? "thread"
                : "threads"}
          </p>

          {(subjectId !== null || tag !== null) && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5 max-md:hidden">
              {subjectId !== null && (
                <FilterChip onRemove={() => void clearRecord()}>
                  About <span className="font-mono text-id">{subjectId}</span>
                </FilterChip>
              )}
              {tag !== null && (
                <FilterChip onRemove={() => setTag(null)}>#{tag}</FilterChip>
              )}
            </div>
          )}

          <div
            aria-busy={threads.isPlaceholderData || undefined}
            className="list-swap"
          >
            {threads.isPending ? (
              <LoadingState>Loading the discussions…</LoadingState>
            ) : threads.isError ? (
              <ErrorState
                error={threads.error}
                onRetry={() => void threads.refetch()}
              />
            ) : rows.length === 0 ? (
              <Card>
                <EmptyState
                  action={
                    filtered || subjectId !== null ? (
                      <div className="flex flex-wrap justify-center gap-2">
                        {filtered && (
                          <Button variant="ghost" onClick={clear}>
                            Clear the filters
                          </Button>
                        )}
                        {subjectId !== null && (
                          <Button
                            variant="primary"
                            onClick={() => setOpening(true)}
                          >
                            Discuss {subjectId}
                          </Button>
                        )}
                      </div>
                    ) : undefined
                  }
                >
                  {subjectId !== null
                    ? "Nobody has opened a discussion about this record yet."
                    : feed === "unread"
                      ? "Nothing has moved since you last read. You are caught up."
                      : feed === "new"
                        ? "You have opened every thread there is."
                        : filtered
                          ? "No thread matches these filters."
                          : "Nobody has opened a discussion yet."}
                </EmptyState>
              </Card>
            ) : phone ? (
              <>
                <PhoneCards
                  rows={rows}
                  rowId={(row) => row.thread_id}
                  spec={threadCard(me)}
                  onOpen={(row) => onOpen(row.thread_id)}
                  more={threads}
                />
                {feed === "unread" && (
                  <Button
                    variant="ghost"
                    className="mt-3 w-full"
                    pending={dismiss.isPending}
                    onClick={() => dismiss.mutate()}
                  >
                    <CheckCheck />
                    Mark all read
                  </Button>
                )}
              </>
            ) : (
              <Card className="overflow-hidden">
                <BoardHeader order={order} onOrder={setOrder} />
                <VirtualList
                  items={rows}
                  more={threads}
                  estimate={82}
                  getKey={(row) => row.thread_id}
                  className="max-h-[calc(100dvh-17rem)]"
                >
                  {(row) => (
                    <TopicRow
                      thread={row}
                      onOpen={() => onOpen(row.thread_id)}
                    />
                  )}
                </VirtualList>
              </Card>
            )}
          </div>
        </div>
      </div>

      <OpenThreadSheet
        key={`${subject ?? "any"}:${subjectId ?? ""}`}
        open={opening}
        onClose={() => setOpening(false)}
        subjectKind={subject}
        subjectId={subjectId}
        people={people}
        onOpened={onOpen}
      />
    </PageContent>
  )
}

function FilterChip({
  children,
  onRemove,
}: {
  children: React.ReactNode
  onRemove: () => void
}) {
  return (
    <span className="inline-flex h-[1.625rem] items-center gap-1 rounded-full border border-accent/30 bg-accent-bg pr-1 pl-2.5 text-meta font-medium text-accent">
      {children}
      <button
        type="button"
        aria-label="Remove this filter"
        onClick={onRemove}
        className="grid size-4 place-items-center rounded-full transition-colors hover:bg-accent/15"
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

/// Categories and tags, down the left.
function Rail({
  subjects,
  selected,
  onSelect,
  tags,
  tag,
  onTag,
}: {
  subjects: ReturnType<typeof useQuery<SubjectCount[]>>
  selected: string | null
  onSelect: (kind: string | null) => void
  tags: ReturnType<typeof useQuery<TagCount[]>>
  tag: string | null
  onTag: (tag: string | null) => void
}) {
  const tagRows = tags.data ?? []
  return (
    <div className="flex min-w-0 flex-col gap-6 text-nav">
      {/* One list under one heading, which is what "every category" means.
          "All topics" is not a different kind of thing from the rows under
          it; it is the first of them, and it is drawn as the first of them. */}
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
                    label={row.label}
                    dot={dotOf(row.subject_kind)}
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

      {tagRows.length > 0 && (
        <div>
          <h3 className="mb-2 px-2 text-eyebrow font-semibold text-mute uppercase">
            Tags
          </h3>
          <div className="flex flex-wrap gap-1.5 px-2">
            {tagRows.slice(0, 24).map((row) => (
              <TagChip
                key={row.tag}
                tag={row.tag}
                count={row.threads}
                selected={tag === row.tag}
                // A tag is a filter of its own now. It used to put itself in
                // the search box, which searched titles — so a tag whose word
                // was not also in a title found nothing, from a chip that
                // said it had threads under it.
                onClick={() => onTag(tag === row.tag ? null : row.tag)}
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
/// Not `<Tag>`: that component is a MONO micro-label for a code. These are
/// words somebody typed, `faktur` and `kewenangan`, and setting a word in 10px
/// semibold mono makes a ragged little wall of them that reads as machine
/// output. Same outline grammar as `<Pill>`, at the size of the rest of the
/// rail, so the column has one voice.
function TagChip({
  tag,
  count: threads,
  selected = false,
  onClick,
}: {
  tag: string
  count?: number
  selected?: boolean
  onClick?: () => void
}) {
  const skin = cn(
    "inline-flex h-[1.625rem] items-center gap-1 rounded-full border px-2.5 text-meta whitespace-nowrap transition-colors",
    selected
      ? "border-accent/30 bg-accent-bg font-medium text-accent"
      : "border-hairline-2 bg-canvas text-body"
  )
  const inner = (
    <>
      {tag}
      {threads !== undefined && (
        <span
          className={cn("tabular-nums", selected ? "text-accent" : "text-mute")}
        >
          {threads}
        </span>
      )}
    </>
  )

  if (onClick === undefined) return <span className={skin}>{inner}</span>

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(skin, !selected && "hover:bg-soft-2 hover:text-ink")}
    >
      {inner}
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
      aria-pressed={selected}
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
/// that lies about which number is which. Under `md` the row of faces and the
/// Views column go: on a phone the title needs the room, and Replies and
/// Activity are the two a person on the shop floor is asking.
const BOARD_GRID =
  "grid grid-cols-[minmax(0,1fr)_3.5rem_4rem] items-center gap-3 px-3.5 md:grid-cols-[minmax(0,1fr)_5rem_4rem_4rem_4.5rem]"

/// The column heads. Replies, Views and Activity are the three every forum
/// converged on, and all three sort; the Topic head sorts by newest.
///
/// Sentence case at the size of the rows, on the tint, one grey lighter —
/// what `<DataTable>` settled on for every other list in the app. The sort
/// mark follows the same table: a pale double chevron where the column COULD
/// be sorted, a solid one where it is. Clicking the chosen column again goes
/// back to the board's resting order, most recent activity first.
function BoardHeader({
  order,
  onOrder,
}: {
  order: ThreadOrder
  onOrder: (order: ThreadOrder) => void
}) {
  const head = (
    key: ThreadOrder,
    label: string,
    end = true,
    className?: string
  ) => (
    <button
      type="button"
      onClick={() => onOrder(order === key ? "activity" : key)}
      className={cn(
        "inline-flex items-center gap-1 transition-colors hover:text-ink",
        end ? "flex-row-reverse justify-self-end" : "justify-self-start",
        order === key && "text-ink",
        className
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
      {head("created", order === "created" ? "Topic · newest" : "Topic", false)}
      <span className="hidden md:block" />
      {head("replies", "Replies")}
      {head("views", "Views", true, "hidden md:inline-flex")}
      {head("activity", "Activity")}
    </div>
  )
}

/// Whether a thread has something the reader has not seen, and which.
///
/// New is a thread never opened by somebody who did not start it; unread is
/// one opened before, with posts by other people since. Discourse draws the
/// two differently for the reason they are different questions: "what is
/// there" and "what moved".
function freshness(thread: DiscussionThread, me: string | undefined) {
  if (!thread.seen_by_me && thread.created_by !== me) return "new" as const
  if (thread.seen_by_me && thread.unread_count > 0) return "unread" as const
  return null
}

/// A thread as a phone's card: the title (pinned and bookmarked marks before
/// it), which record it is about and what it was filed under, how many replies
/// it has, when it last moved and by whom, and what is new in it for this reader.
function threadCard(me: string | undefined): CardSpec<DiscussionThread> {
  return {
    title: (thread) => (
      <span className="flex items-start gap-1.5">
        {thread.pinned_at !== null && (
          <Pin
            aria-label="Pinned"
            className="mt-1 size-3.5 shrink-0 rotate-45 text-accent"
          />
        )}
        {thread.bookmarked_by_me && (
          <Bookmark
            aria-label="Bookmarked"
            className="mt-1 size-3.5 shrink-0 fill-accent text-accent"
          />
        )}
        <span className="min-w-0 break-words">{thread.title}</span>
      </span>
    ),
    meta: [
      (thread) => `${thread.subject_label} · ${thread.subject_id}`,
      (thread) => (thread.tags.length === 0 ? null : thread.tags.join(" · ")),
    ],
    lead: (thread) => (
      <CardFigure
        value={count(thread.reply_count)}
        caption={thread.reply_count === 1 ? "reply" : "replies"}
        tone={thread.reply_count === 0 ? "quiet" : undefined}
      />
    ),
    foot: (thread) =>
      thread.last_poster !== null && thread.reply_count > 0
        ? `${ago(thread.last_activity_at)} · last by ${thread.last_poster}`
        : ago(thread.last_activity_at),
    action: (thread) => {
      const fresh = freshness(thread, me)
      return fresh === "unread" ? (
        <Pill tone="new">{thread.unread_count} new</Pill>
      ) : fresh === "new" ? (
        <Pill tone="new">New</Pill>
      ) : thread.status !== "open" ? (
        <Pill tone={threadTone(thread.status)}>
          {THREAD_STATUS_LABEL[thread.status] ?? thread.status}
        </Pill>
      ) : null
    },
  }
}

/// One row of the board: the title, its category and tags underneath, then the
/// numbers.
function TopicRow({
  thread,
  onOpen,
}: {
  thread: DiscussionThread
  onOpen: () => void
}) {
  const me = useIdentity().data?.username
  const fresh = freshness(thread, me)
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen()
      }}
      className={cn(
        BOARD_GRID,
        "cursor-pointer border-b border-hairline py-2.5 transition-colors outline-none last:border-b-0 hover:bg-soft focus-visible:bg-soft"
      )}
    >
      <div className="min-w-0">
        {/* The title wraps rather than truncating. A forum row exists to be
            read, and a board of ellipses is a board nobody can scan. Two lines
            is the cap because a third is a paragraph. */}
        <div className="flex items-start gap-1.5">
          {thread.pinned_at !== null && (
            <Pin
              aria-label="Pinned"
              className="mt-[0.1875rem] size-3 shrink-0 rotate-45 text-accent"
            />
          )}
          {thread.bookmarked_by_me && (
            <Bookmark
              aria-label="Bookmarked"
              className="mt-[0.1875rem] size-3 shrink-0 fill-accent text-accent"
            />
          )}
          <span
            className={cn(
              "line-clamp-2 min-w-0 text-[0.9375rem] leading-snug text-ink",
              fresh !== null ? "font-semibold" : "font-medium"
            )}
          >
            {thread.title}
          </span>
          {fresh === "unread" && (
            <span
              title={`${thread.unread_count} new since you last read it`}
              className="mt-px inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[0.9375rem] leading-none font-semibold text-canvas tabular-nums"
            >
              {thread.unread_count > 99 ? "99+" : thread.unread_count}
            </span>
          )}
          {fresh === "new" && (
            <span className="mt-px shrink-0">
              <Pill tone="new">New</Pill>
            </span>
          )}
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
            under — a separator between the record's name and the labels, which
            is cheaper than a chip per tag and at twenty rows is not confetti. */}
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-pill text-mute">
          <span className="flex shrink-0 items-center gap-1.5 text-body">
            <span
              className={cn(
                "size-2 rounded-[0.125rem]",
                dotOf(thread.subject_kind)
              )}
            />
            {thread.subject_label}
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
          {thread.last_poster !== null && thread.reply_count > 0 && (
            <span className="hidden truncate lg:inline">
              · last by {thread.last_poster}
            </span>
          )}
        </div>
      </div>

      <div className="hidden md:block">
        <Voices names={thread.voices} />
      </div>

      <span className="text-right text-meta text-body tabular-nums">
        {count(thread.reply_count)}
      </span>
      <span className="hidden text-right text-meta text-body tabular-nums md:block">
        {count(thread.people)}
      </span>
      <span
        className="text-right text-pill text-mute"
        title={moment(thread.last_activity_at)}
      >
        {ago(thread.last_activity_at)}
      </span>
    </div>
  )
}

// ---- One thread, on its own page ---------------------------------------

/// Where a thread's draft reply is kept between visits. Per thread and per
/// browser: a reply half-written on Tuesday is still there on Wednesday, and
/// never shows up under a different thread.
function draftKey(threadId: string) {
  return `itulah.discussion-draft.${threadId}`
}

function readDraft(threadId: string): string {
  try {
    return window.localStorage.getItem(draftKey(threadId)) ?? ""
  } catch {
    return ""
  }
}

function writeDraft(threadId: string, body: string) {
  try {
    if (body.trim() === "") window.localStorage.removeItem(draftKey(threadId))
    else window.localStorage.setItem(draftKey(threadId), body)
  } catch {
    // Private windows and full disks refuse; the draft is then this tab's only.
  }
}

/// A thread's own address, or one post's: the thread's link plus `#post-N`.
function threadLink(threadId: string, seq?: number) {
  const url = new URL(window.location.href)
  url.search = ""
  url.searchParams.set("thread", threadId)
  url.hash = seq === undefined ? "" : `post-${seq}`
  return url.toString()
}

function copyLink(url: string, said: string) {
  if (navigator.clipboard === undefined) {
    toast.error("This browser will not copy from here — copy the address bar.")
    return
  }
  void navigator.clipboard.writeText(url).then(
    () => toast.success(said),
    () => toast.error("The link could not be copied")
  )
}

/// Bring a post into view and mark it for a moment, so the eye lands on it.
function reveal(seq: number) {
  const target = document.getElementById(`post-${seq}`)
  if (target === null) return
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  target.scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "center",
  })
  target.dataset.flash = "true"
  window.setTimeout(() => {
    delete target.dataset.flash
  }, 1600)
}

/// The thread, and everything a person may do to it.
///
/// A page rather than a sheet: this is read to the end. The reading column is
/// capped and the meta sits beside it, which is what every forum does.
function OneThread({
  id,
  onBack,
  people,
}: {
  id: string
  onBack: () => void
  people: readonly Mentionable[]
}) {
  const client = useQueryClient()
  const me = useIdentity().data?.username
  const attachments = useAttachments()

  // Always asked again on arrival, never answered from the cache. Opening a
  // thread IS the read that moves the reading position, and a cached answer
  // from a visit twenty seconds ago would skip it — the board kept the thread
  // under Unread, and the "new" line was drawn from the previous visit.
  const detail = useQuery({
    queryKey: workplaceKeys.thread(id),
    queryFn: ({ signal }) => readThread(id, signal),
    staleTime: 0,
  })

  const posts = useQuery({
    queryKey: workplaceKeys.posts(id),
    queryFn: ({ signal }) => readPosts(id, signal),
    staleTime: 0,
  })

  /// Where the reader stood when they arrived. Frozen at the first answer: the
  /// server moves the position to the end on every read, so a later refetch —
  /// a live reply arriving — would otherwise walk the "new" line down the page
  /// while it was being read. `null` is a first visit, where everything is new
  /// and a line above the first post would say nothing.
  ///
  /// Only from an answer fetched on THIS visit: the cached one drawn while it
  /// is on its way is where the reader stood the time before.
  const [since, setSince] = useState<number | null | undefined>(undefined)
  if (
    since === undefined &&
    detail.data !== undefined &&
    detail.isFetchedAfterMount
  ) {
    setSince(detail.data.seen_by_me ? detail.data.last_read_seq : null)
  }

  // Reading moved this thread's row out of Unread; the board should say so
  // when it is next drawn.
  const readAt = detail.dataUpdatedAt
  useEffect(() => {
    if (readAt === 0) return
    void client.invalidateQueries({
      queryKey: ["workplace", "discussions", "list"],
    })
  }, [readAt, client])

  // The draft, kept across reloads until the server has it.
  const [draft, setDraftState] = useState(() => readDraft(id))
  const setDraft = (body: string) => {
    setDraftState(body)
    writeDraft(id, body)
  }
  const [replyTo, setReplyTo] = useState<DiscussionPost | null>(null)
  // Minted on a reply's first attempt and kept across its retries, so a resend
  // after a dropped connection lands once. Cleared only when the server has
  // it, so the next reply gets its own.
  const replyKey = useRef<string | null>(null)
  const composer = useRef<HTMLDivElement>(null)

  const [editing, setEditing] = useState<{
    postId: string
    body: string
  } | null>(null)
  const [withdrawing, setWithdrawing] = useState<DiscussionPost | null>(null)
  const [history, setHistory] = useState<DiscussionPost | null>(null)
  const [retitling, setRetitling] = useState(false)

  const refreshThread = () => {
    void client.invalidateQueries({ queryKey: workplaceKeys.thread(id) })
    void client.invalidateQueries({ queryKey: workplaceKeys.posts(id) })
    refreshBoard(client)
  }

  /// A thread the server answered with — every thread write returns the
  /// thread as it now reads — goes straight into the cache, so the header
  /// changes on the click rather than a round trip later. The reading
  /// position is kept as it was: this answer was not a visit.
  const takeThread = (thread: DiscussionThread) => {
    client.setQueryData<DiscussionThread>(
      workplaceKeys.thread(id),
      (previous) =>
        previous === undefined
          ? thread
          : {
              ...thread,
              last_read_seq: previous.last_read_seq,
              seen_by_me: previous.seen_by_me,
            }
    )
    refreshBoard(client)
  }

  /// One post the server answered with, in place.
  const takePost = (post: DiscussionPost) => {
    client.setQueryData<DiscussionPost[]>(workplaceKeys.posts(id), (previous) =>
      previous?.map((one) => (one.post_id === post.post_id ? post : one))
    )
  }

  const reply = useMutation({
    mutationFn: (body: string) => {
      replyKey.current ??= idempotencyKey()
      return replyToThread(id, body, attachments.ids, {
        replyTo: replyTo?.seq ?? null,
        idempotencyKey: replyKey.current,
      })
    },
    onSuccess: (post) => {
      replyKey.current = null
      attachments.clear()
      setDraft("")
      setReplyTo(null)
      client.setQueryData<DiscussionPost[]>(
        workplaceKeys.posts(id),
        (previous) =>
          previous === undefined ||
          previous.some((one) => one.post_id === post.post_id)
            ? previous
            : [...previous, post]
      )
      // A reply with a file on it is a new row on the Files screen.
      void client.invalidateQueries({ queryKey: workplaceKeys.files() })
      refreshThread()
      window.requestAnimationFrame(() => reveal(post.seq))
    },
  })

  const edit = useMutation({
    mutationFn: ({ postId, body }: { postId: string; body: string }) =>
      editPost(id, postId, body),
    onSuccess: (post) => {
      setEditing(null)
      takePost(post)
      refreshBoard(client)
    },
  })

  const withdraw = useMutation({
    mutationFn: (postId: string) => withdrawPost(id, postId),
    onSuccess: (post) => {
      setWithdrawing(null)
      takePost(post)
      if (replyTo?.post_id === post.post_id) setReplyTo(null)
      refreshThread()
    },
  })

  const react = useMutation({
    mutationFn: ({
      postId,
      reaction,
      on,
    }: {
      postId: string
      reaction: string
      on: boolean
    }) => reactToPost(id, postId, reaction, on),
    onSuccess: (reactions: PostReaction[], { postId }) => {
      client.setQueryData<DiscussionPost[]>(
        workplaceKeys.posts(id),
        (previous) =>
          previous?.map((one) =>
            one.post_id === postId ? { ...one, reactions } : one
          )
      )
    },
  })

  const bookmark = useMutation({
    mutationFn: (marked: boolean) => setBookmark(id, marked),
    onSuccess: ({ marked }) => {
      client.setQueryData<DiscussionThread>(
        workplaceKeys.thread(id),
        (previous) =>
          previous === undefined
            ? previous
            : { ...previous, bookmarked_by_me: marked }
      )
      refreshBoard(client)
    },
  })

  const follow = useMutation({
    mutationFn: (level: string) => setSubscription(id, level),
    onSuccess: ({ level }) => {
      client.setQueryData<DiscussionThread>(
        workplaceKeys.thread(id),
        (previous) =>
          previous === undefined
            ? previous
            : { ...previous, subscription: level }
      )
      refreshBoard(client)
    },
  })

  const status = useMutation({
    mutationFn: (next: string) => setThreadStatus(id, next),
    onSuccess: (thread) => {
      takeThread(thread)
      // Locking changes what every post allows — no edits, no reactions.
      void client.invalidateQueries({ queryKey: workplaceKeys.posts(id) })
    },
  })

  const pin = useMutation({
    mutationFn: (pinned: boolean) => setPin(id, pinned),
    onSuccess: (thread) => takeThread(thread),
  })

  const solution = useMutation({
    mutationFn: (postId: string | null) => acceptSolution(id, postId),
    onSuccess: (thread) => {
      takeThread(thread)
      void client.invalidateQueries({ queryKey: workplaceKeys.posts(id) })
    },
  })

  const failure = [
    reply.error,
    edit.error,
    withdraw.error,
    react.error,
    bookmark.error,
    follow.error,
    status.error,
    pin.error,
    solution.error,
  ].find((error): error is Error => error instanceof Error)

  // Land where the reader means to be: the post the link names, or the first
  // one they have not read. Once, when the posts first arrive — never again,
  // or a live reply would yank the page away from whatever is being read.
  const landed = useRef(false)
  const rows = posts.data
  useEffect(() => {
    if (landed.current || rows === undefined || since === undefined) return
    landed.current = true
    const named = /^#post-(\d+)$/.exec(window.location.hash)
    if (named !== null) {
      const seq = Number(named[1])
      window.requestAnimationFrame(() => reveal(seq))
      return
    }
    if (since === null) return
    const first = rows.find(
      (post) =>
        post.seq > since && post.author !== me && post.withdrawn_at === null
    )
    if (first !== undefined && first.seq > 1) {
      window.requestAnimationFrame(() => reveal(first.seq))
    }
  }, [rows, since, me])

  /// The first post somebody else wrote after the reader's position — where
  /// the "new since your last visit" line goes.
  const firstUnread = useMemo(() => {
    if (rows === undefined || since === null || since === undefined) return null
    return (
      rows.find(
        (post) =>
          post.seq > since && post.author !== me && post.withdrawn_at === null
      )?.seq ?? null
    )
  }, [rows, since, me])

  /// Reply to a post — and if some of its words are selected, quote them.
  ///
  /// Discourse's gesture: select the sentence you are answering, press
  /// Reply, and it arrives in the box as a quote. Only a selection inside
  /// THIS post's words counts; one left over somewhere else on the page is
  /// not what the reader meant to answer.
  const startReply = (post: DiscussionPost | null) => {
    setReplyTo(post)
    const selection = window.getSelection()
    const body =
      post === null
        ? null
        : document.querySelector(`#post-${post.seq} [data-post-body]`)
    if (
      selection !== null &&
      body !== null &&
      !selection.isCollapsed &&
      selection.anchorNode !== null &&
      selection.focusNode !== null &&
      body.contains(selection.anchorNode) &&
      body.contains(selection.focusNode)
    ) {
      const quoted = selection
        .toString()
        .trim()
        .split("\n")
        .map((line) => `> ${line}`.trimEnd())
        .join("\n")
      if (quoted !== "") {
        setDraft(
          draft.trim() === ""
            ? `${quoted}\n\n`
            : `${draft.trimEnd()}\n\n${quoted}\n\n`
        )
      }
      selection.removeAllRanges()
    }
    window.requestAnimationFrame(() => {
      composer.current?.scrollIntoView({ block: "center", behavior: "smooth" })
      composer.current?.querySelector("textarea")?.focus()
    })
  }

  const send = () => {
    if (reply.isPending || attachments.uploading || draft.trim() === "") return
    reply.mutate(draft.trim())
  }

  return (
    <PageContent>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-mute transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Discussions
      </button>

      {queryState(detail, {
        loading: "Loading the thread…",
        render: (open) => {
          const locked = open.status === "locked"
          const where = recordRoute(open.subject_kind, open.subject_id)
          const answer = rows?.find((post) => post.is_solution)
          return (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
              <div className="min-w-0">
                {retitling ? (
                  <RetitleForm
                    thread={open}
                    onCancel={() => setRetitling(false)}
                    onSaved={(thread) => {
                      takeThread(thread)
                      setRetitling(false)
                    }}
                  />
                ) : (
                  <>
                    <div className="flex items-start gap-2">
                      <h1 className="min-w-0 flex-1 text-hero font-semibold text-balance text-ink">
                        {open.pinned_at !== null && (
                          <Pin
                            aria-label="Pinned"
                            className="mr-1.5 mb-1 inline size-4 rotate-45 text-accent"
                          />
                        )}
                        {open.title}
                      </h1>
                      {open.can_manage && (
                        <Button
                          variant="quiet"
                          size="icon"
                          aria-label="Edit the title, note and tags"
                          title="Edit the title, note and tags"
                          onClick={() => setRetitling(true)}
                        >
                          <Pencil />
                        </Button>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                      <span className="flex items-center gap-1.5 text-meta text-body">
                        <span
                          className={cn(
                            "size-2.5 rounded-[0.1875rem]",
                            dotOf(open.subject_kind)
                          )}
                        />
                        {open.subject_label}
                      </span>
                      {where === null ? (
                        <span className="font-mono text-id text-mute">
                          {open.subject_id}
                        </span>
                      ) : (
                        // The record itself, one click away. A thread about a
                        // purchase order that cannot open the order sends its
                        // reader to search for it.
                        <AppLink
                          to={where.to}
                          sheet={where.sheet}
                          className="inline-flex items-center gap-0.5 font-mono text-id text-accent hover:underline"
                        >
                          {open.subject_id}
                          <ArrowUpRight className="size-3" />
                        </AppLink>
                      )}
                      {open.tags.map((tag) => (
                        <TagChip key={tag} tag={tag} />
                      ))}
                      <Pill tone={threadTone(open.status)}>
                        {THREAD_STATUS_LABEL[open.status] ?? open.status}
                      </Pill>
                      {open.has_solution && answer !== undefined && (
                        <button
                          type="button"
                          onClick={() => reveal(answer.seq)}
                          className="rounded-inner"
                        >
                          <Pill tone="ok" withDot>
                            Answered in #{answer.seq}
                          </Pill>
                        </button>
                      )}
                      {open.edited_at !== null && (
                        <span
                          className="text-pill text-mute"
                          title={moment(open.edited_at)}
                        >
                          edited {ago(open.edited_at)}
                        </span>
                      )}
                    </div>

                    {open.subject_note && (
                      <p className="mt-1.5 text-meta text-body">
                        {open.subject_note}
                      </p>
                    )}
                  </>
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
                    render: (list) =>
                      list.length === 0 ? (
                        <EmptyState>
                          This thread has no opening post, which should not be
                          possible — the server writes one with the thread.
                        </EmptyState>
                      ) : (
                        // Not virtualised, unlike the board. A thread is read
                        // from the top and the page itself scrolls, so an inner
                        // scroller would put a second bar inside the first.
                        <div>
                          {list.map((post, index) => (
                            <Fragment key={post.post_id}>
                              {post.seq === firstUnread && index > 0 && (
                                <div
                                  role="separator"
                                  aria-label="New since your last visit"
                                  className="my-2 flex items-center gap-2"
                                >
                                  <span className="h-px flex-1 bg-accent/40" />
                                  <span className="text-pill font-medium text-accent">
                                    New since your last visit
                                  </span>
                                  <span className="h-px flex-1 bg-accent/40" />
                                </div>
                              )}
                              <Post
                                post={post}
                                thread={open}
                                me={me}
                                showDay={
                                  index === 0 ||
                                  dayOf(list[index - 1].created_at) !==
                                    dayOf(post.created_at)
                                }
                                editing={
                                  editing?.postId === post.post_id
                                    ? editing.body
                                    : null
                                }
                                onEditChange={(body) =>
                                  setEditing({ postId: post.post_id, body })
                                }
                                onEdit={() =>
                                  setEditing({
                                    postId: post.post_id,
                                    body: post.body,
                                  })
                                }
                                onCancelEdit={() => setEditing(null)}
                                onSaveEdit={() => {
                                  if (
                                    editing === null ||
                                    editing.body.trim() === "" ||
                                    edit.isPending
                                  )
                                    return
                                  edit.mutate({
                                    postId: editing.postId,
                                    body: editing.body.trim(),
                                  })
                                }}
                                saving={edit.isPending}
                                people={people}
                                onReply={() => startReply(post)}
                                onWithdraw={() => setWithdrawing(post)}
                                onHistory={() => setHistory(post)}
                                onAccept={() => solution.mutate(post.post_id)}
                                onUnaccept={() => solution.mutate(null)}
                                accepting={solution.isPending}
                                onReact={(reaction, on) =>
                                  react.mutate({
                                    postId: post.post_id,
                                    reaction,
                                    on,
                                  })
                                }
                                reacting={react.isPending}
                                onJump={reveal}
                              />
                              {index === 0 && (
                                <AnswerPreview
                                  answer={list.find((one) => one.is_solution)}
                                  me={me}
                                  onJump={reveal}
                                />
                              )}
                            </Fragment>
                          ))}
                        </div>
                      ),
                  })}
                </div>

                <div
                  ref={composer}
                  className="mt-5 border-t border-hairline pt-4"
                >
                  {locked ? (
                    <p className="text-meta text-mute">
                      This thread is locked. Nobody can reply to it
                      {open.can_manage ? " until it is reopened." : "."}
                    </p>
                  ) : (
                    <>
                      {replyTo !== null && (
                        <div className="mb-2 flex items-center gap-2 rounded-inner bg-soft px-2.5 py-1.5 text-meta text-body">
                          <CornerUpLeft className="size-3.5 shrink-0 text-mute" />
                          <span className="min-w-0 truncate">
                            Replying to{" "}
                            <button
                              type="button"
                              onClick={() => reveal(replyTo.seq)}
                              className="font-medium text-ink hover:underline"
                            >
                              #{replyTo.seq} {replyTo.author_name}
                            </button>
                          </span>
                          <button
                            type="button"
                            aria-label="Reply to the thread instead"
                            onClick={() => setReplyTo(null)}
                            className="ml-auto grid size-5 shrink-0 place-items-center rounded-full text-mute transition-colors hover:bg-hairline hover:text-ink"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      )}
                      <PostEditor
                        value={draft}
                        onChange={setDraft}
                        rows={3}
                        people={people}
                        me={me}
                        attachments={attachments.pending}
                        onAttach={attachments.add}
                        onRemoveAttachment={attachments.remove}
                        onSubmit={send}
                        footer={
                          <Button
                            variant="primary"
                            pending={reply.isPending}
                            disabled={
                              draft.trim() === "" || attachments.uploading
                            }
                            onClick={send}
                          >
                            {reply.isPending ? "Posting…" : "Post reply"}
                          </Button>
                        }
                      />
                    </>
                  )}
                </div>
              </div>

              <aside className="flex min-w-0 flex-col gap-4">
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant={open.bookmarked_by_me ? "soft" : "ghost"}
                    pending={bookmark.isPending}
                    onClick={() => bookmark.mutate(!open.bookmarked_by_me)}
                    className="gap-1.5"
                  >
                    <Bookmark
                      className={cn(
                        "size-3.5",
                        open.bookmarked_by_me && "fill-accent text-accent"
                      )}
                    />
                    {open.bookmarked_by_me ? "Bookmarked" : "Bookmark"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => copyLink(threadLink(id), "Link copied")}
                    className="gap-1.5"
                  >
                    <Link2 className="size-3.5" />
                    Copy link
                  </Button>
                </div>

                <div>
                  <h4 className="mb-1 text-eyebrow font-semibold text-mute uppercase">
                    Notifications
                  </h4>
                  <ChoiceMenu
                    heading="Tell me about"
                    icon={Bell}
                    value={open.subscription}
                    options={SUBSCRIPTION_LEVELS.map((level) => ({
                      value: level.value,
                      label: level.label,
                    }))}
                    onChange={(level) => {
                      if (level !== null && level !== open.subscription)
                        follow.mutate(level)
                    }}
                    className="-ml-[0.5625rem]"
                  />
                  <p className="text-pill text-mute">
                    {SUBSCRIPTION_LEVELS.find(
                      (level) => level.value === open.subscription
                    )?.hint ?? ""}
                  </p>
                </div>

                <div className="text-[0.9375rem]">
                  <KeyValue term="Opened by">{open.created_by}</KeyValue>
                  <KeyValue term="Opened">
                    <span title={moment(open.created_at)}>
                      {ago(open.created_at)}
                    </span>
                  </KeyValue>
                  <KeyValue term="Replies">{count(open.reply_count)}</KeyValue>
                  <KeyValue term="Read it">{count(open.people)}</KeyValue>
                  <KeyValue term="Last activity">
                    <span title={moment(open.last_activity_at)}>
                      {ago(open.last_activity_at)}
                    </span>
                  </KeyValue>
                  {open.pinned_by !== null && (
                    <KeyValue term="Pinned by">{open.pinned_by}</KeyValue>
                  )}
                </div>

                {open.voices.length > 0 && (
                  <div>
                    <h4 className="mb-1.5 text-eyebrow font-semibold text-mute uppercase">
                      In this thread
                    </h4>
                    <ul className="flex flex-col gap-1">
                      {open.voices.map((name) => (
                        <li
                          key={name}
                          className="flex items-center gap-2 text-meta text-text"
                        >
                          <Avatar name={name} size="sm" />
                          <span className="min-w-0 truncate">
                            {people.find((person) => person.username === name)
                              ?.name ?? name}
                          </span>
                          {name === open.created_by && (
                            <span className="ml-auto shrink-0 text-pill text-mute">
                              opened it
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Only whoever opened a thread — and head office — may say it
                    is answered or close it, so for everybody else the pill
                    above is the whole story. */}
                {open.can_manage && (
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
                        disabled={
                          status.isPending || open.status === "resolved"
                        }
                        onClick={() => status.mutate("resolved")}
                      >
                        <CheckCheck className="mr-1 inline size-3.5" />
                        Answered
                      </button>
                      <button
                        type="button"
                        disabled={status.isPending || locked}
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

                {open.can_pin && (
                  <Button
                    variant="ghost"
                    pending={pin.isPending}
                    onClick={() => pin.mutate(open.pinned_at === null)}
                    className="justify-start gap-1.5"
                  >
                    {open.pinned_at === null ? (
                      <>
                        <Pin className="size-3.5" />
                        Pin to the top of the board
                      </>
                    ) : (
                      <>
                        <PinOff className="size-3.5" />
                        Unpin
                      </>
                    )}
                  </Button>
                )}

                {/* The record's own log. A thread that cannot show what was
                    done to it is a thread missing half its history. */}
                <SameRecord thread={open} />

                <RecordPanel subject={{ kind: "discussion", id }} />
              </aside>
            </div>
          )
        },
      })}

      <Dialog
        open={withdrawing !== null}
        onOpenChange={(next) => {
          if (!next) setWithdrawing(null)
        }}
        title="Withdraw this post?"
        confirm="Withdraw it"
        tone="danger"
        pending={withdraw.isPending}
        onConfirm={() => {
          if (withdrawing !== null) withdraw.mutate(withdrawing.post_id)
        }}
      >
        Its words, its files and its reactions leave the thread. Its place
        stays, marked as withdrawn, so replies that answered it still make
        sense.
        {withdrawing?.is_solution === true &&
          " It is the accepted answer, so the thread goes back to open."}
      </Dialog>

      <Panel
        open={history !== null}
        onOpenChange={(next) => {
          if (!next) setHistory(null)
        }}
        title={history === null ? "Edits" : `Edits to #${history.seq}`}
        sub="Every earlier wording, oldest first, and the one that stands now."
      >
        {history !== null && <Revisions threadId={id} post={history} me={me} />}
      </Panel>
    </PageContent>
  )
}

/// The image types the server hands back `inline` — `may_render_inline` in
/// `cloud/http/files.rs`. Anything else would arrive as a download, and an
/// `<img>` pointed at a download draws a broken picture.
const PICTURES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
])

function isPicture(contentType: string): boolean {
  return PICTURES.has(contentType.split(";")[0].trim().toLowerCase())
}

/// A post's files: photographs drawn, everything else listed.
///
/// A fault report from a shop is usually a photograph of the fault, and a
/// chip that says "IMG_2041.jpg · 2.1 MB" makes everybody download it to see
/// the one thing the post is about. So pictures are shown where they were
/// posted, each a link to the full size; a picture whose bytes are gone falls
/// back to the chip, which says so.
function PostFiles({ post }: { post: DiscussionPost }) {
  const pictures = post.attachments.filter(
    (file) => file.available && isPicture(file.content_type)
  )
  const others = post.attachments.filter((file) => !pictures.includes(file))
  return (
    <div className="mt-2.5 flex flex-col gap-2">
      {pictures.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pictures.map((file) => {
            const href = discussionAttachmentUrl(post.thread_id, file.file_id)
            return (
              <a
                key={file.file_id}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={file.file_name}
                className="block overflow-hidden rounded-inner border border-hairline bg-soft transition-opacity hover:opacity-90"
              >
                <img
                  src={href}
                  alt={file.file_name}
                  loading="lazy"
                  decoding="async"
                  className="h-40 w-auto max-w-[16rem] object-cover"
                />
              </a>
            )
          })}
        </div>
      )}
      {others.map((file) => (
        <AttachmentLink
          key={file.file_id}
          name={file.file_name}
          size={file.byte_size}
          available={file.available}
          href={discussionAttachmentUrl(post.thread_id, file.file_id)}
        />
      ))}
    </div>
  )
}

/// The accepted answer, shown again under the question.
///
/// What the Solved plugin does on Discourse, and for the same reason: most
/// people who open an answered thread came for the answer, and in a thread of
/// fifteen replies it is somewhere in the middle. The question, then straight
/// away what settled it, then the argument for whoever wants it.
function AnswerPreview({
  answer,
  me,
  onJump,
}: {
  answer: DiscussionPost | undefined
  me: string | undefined
  onJump: (seq: number) => void
}) {
  if (answer === undefined || answer.seq === 1) return null
  return (
    <div className="my-2 rounded-inner border border-ok-fg/30 bg-ok-bg px-3.5 py-3">
      <div className="mb-1.5 flex items-center gap-2">
        <CheckCheck className="size-3.5 text-ok-fg" />
        <span className="text-meta font-medium text-ok-fg">
          Answered by {answer.author_name}
        </span>
        <button
          type="button"
          onClick={() => onJump(answer.seq)}
          className="ml-auto text-pill font-medium text-ok-fg hover:underline"
        >
          Go to #{answer.seq}
        </button>
      </div>
      {/* Cut at five lines: this is a pointer to the answer, not a second
          copy of a long one. The whole of it is one click down. */}
      <div className="max-h-[7.5rem] overflow-hidden">
        <Markdown text={answer.body} me={me} />
      </div>
    </div>
  )
}

/// The other threads about the same record.
///
/// Discourse closes a topic with "suggested topics"; here the suggestion is
/// exact rather than guessed, because every thread names its record. An
/// argument about a purchase order's price is very often the second argument
/// about that order, and the first one usually holds half the answer.
function SameRecord({ thread }: { thread: DiscussionThread }) {
  const open = useSheet("thread")
  const filter: ThreadFilter = {
    subjectKind: thread.subject_kind,
    subjectId: thread.subject_id,
    limit: 6,
  }
  const others = useQuery({
    queryKey: workplaceKeys.threads(filter),
    queryFn: ({ signal }) => listThreads(filter, signal),
  })
  const rows = (others.data ?? [])
    .filter((other) => other.thread_id !== thread.thread_id)
    .slice(0, 5)
  if (rows.length === 0) return null
  return (
    <div>
      <h4 className="mb-1.5 text-eyebrow font-semibold text-mute uppercase">
        Also about {thread.subject_id}
      </h4>
      <ul className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.thread_id}>
            <button
              type="button"
              onClick={() => open.open(row.thread_id)}
              className="-mx-2 flex w-[calc(100%+1rem)] flex-col rounded-inner px-2 py-1 text-left transition-colors hover:bg-soft"
            >
              <span className="line-clamp-2 text-meta font-medium text-ink">
                {row.title}
              </span>
              <span className="text-pill text-mute">
                {THREAD_STATUS_LABEL[row.status] ?? row.status} ·{" "}
                {count(row.reply_count)}{" "}
                {row.reply_count === 1 ? "reply" : "replies"} ·{" "}
                {ago(row.last_activity_at)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/// Retitle a thread, reword its note, refile its tags.
function RetitleForm({
  thread,
  onCancel,
  onSaved,
}: {
  thread: DiscussionThread
  onCancel: () => void
  onSaved: (thread: DiscussionThread) => void
}) {
  const [title, setTitle] = useState(thread.title)
  const [note, setNote] = useState(thread.subject_note ?? "")
  const [tags, setTags] = useState(thread.tags.join(", "))
  const [kind, setKind] = useState(thread.subject_kind)
  const [recordId, setRecordId] = useState(thread.subject_id)

  const kinds = useQuery({
    queryKey: workplaceKeys.kinds(),
    queryFn: ({ signal }) => subjectKinds(signal),
    staleTime: Infinity,
  })

  /// Whether the record changed. Only then is it sent: the server reads a
  /// record in the request as "move it", and a thread re-saved with its own
  /// record would be a move to where it already is.
  const moved =
    kind !== thread.subject_kind || recordId.trim() !== thread.subject_id

  const save = useMutation({
    mutationFn: () =>
      editThread(thread.thread_id, {
        title: title.trim(),
        subject_note: note.trim() === "" ? null : note.trim(),
        tags: splitTags(tags),
        subject_kind: moved ? kind : null,
        subject_id: moved ? recordId.trim() : null,
      }),
    onSuccess: onSaved,
  })

  const ready = title.trim() !== "" && kind !== "" && recordId.trim() !== ""

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (ready && !save.isPending) save.mutate()
      }}
      className="grid grid-cols-1 gap-3 rounded-card border border-hairline-2 p-4 md:grid-cols-2"
    >
      {save.error instanceof Error && (
        <Banner tone="bad" className="md:col-span-2">
          {save.error.message}
        </Banner>
      )}
      <Field label="Title" className="md:col-span-2" required>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          autoFocus
        />
      </Field>
      <Field label="What it is about" required>
        <Select value={kind} onChange={setKind}>
          {(kinds.data ?? []).map((option) => (
            <option key={option.kind} value={option.kind}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Which one"
        required
        hint={
          moved
            ? `Moves the thread from ${thread.subject_id} — its replies go with it.`
            : "The record's own identifier."
        }
      >
        <Input
          value={recordId}
          onChange={(event) => setRecordId(event.target.value)}
          maxLength={120}
        />
      </Field>
      <Field
        label="Note"
        hint="What the record is, for a reader who has not opened it."
      >
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={200}
        />
      </Field>
      <Field label="Tags" hint="Comma separated, up to eight.">
        <Input value={tags} onChange={(event) => setTags(event.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 md:col-span-2">
        <Button data-cancel variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          pending={save.isPending}
          disabled={!ready}
        >
          {save.isPending ? "Submitting…" : moved ? "Save and move" : "Submit"}
        </Button>
      </div>
    </form>
  )
}

/// A post's earlier wordings, and the one that stands now.
function Revisions({
  threadId,
  post,
  me,
}: {
  threadId: string
  post: DiscussionPost
  me: string | undefined
}) {
  const revisions = useQuery({
    queryKey: workplaceKeys.revisions(threadId, post.post_id),
    queryFn: ({ signal }) => postRevisions(threadId, post.post_id, signal),
  })
  return queryState(revisions, {
    loading: "Reading the edits…",
    render: (list) =>
      list.length === 0 ? (
        <EmptyState>This post has not been edited.</EmptyState>
      ) : (
        <ol className="flex flex-col gap-4">
          {list.map((revision) => (
            <li
              key={revision.revision}
              className="rounded-inner border border-hairline p-3"
            >
              <p className="mb-2 text-pill text-mute">
                Version {revision.revision} · replaced by {revision.replaced_by}{" "}
                <span title={moment(revision.replaced_at)}>
                  {ago(revision.replaced_at)}
                </span>
              </p>
              <Markdown text={revision.body} me={me} />
            </li>
          ))}
          <li className="rounded-inner border border-accent/30 bg-accent-bg/40 p-3">
            <p className="mb-2 text-pill font-medium text-accent">Now</p>
            <Markdown text={post.body} me={me} />
          </li>
        </ol>
      ),
  })
}

const MENU_ITEM =
  "flex min-h-8 cursor-default items-center gap-2 rounded-inner px-2 text-[0.9375rem] text-text outline-none select-none data-[highlighted]:bg-soft-2 [&_svg]:size-3.5 [&_svg]:text-mute"

/// One post, in the shape a forum draws it: the face in a gutter on the left,
/// who and when on the first line, and the words at full width under them. No
/// box — a card per post turns a conversation into a list of receipts.
function Post({
  post,
  thread,
  me,
  showDay,
  editing,
  onEditChange,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  saving,
  people,
  onReply,
  onWithdraw,
  onHistory,
  onAccept,
  onUnaccept,
  accepting,
  onReact,
  reacting,
  onJump,
}: {
  post: DiscussionPost
  thread: DiscussionThread
  me: string | undefined
  showDay: boolean
  /// The body being written in place of this post's, or null when not editing.
  editing: string | null
  onEditChange: (body: string) => void
  onEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  saving: boolean
  people: readonly Mentionable[]
  onReply: () => void
  onWithdraw: () => void
  onHistory: () => void
  onAccept: () => void
  onUnaccept: () => void
  accepting: boolean
  onReact: (reaction: string, on: boolean) => void
  reacting: boolean
  onJump: (seq: number) => void
}) {
  const withdrawn = post.withdrawn_at !== null
  const locked = thread.status === "locked"
  const opening = post.seq === 1
  const canAccept = thread.can_manage && !locked && !opening && !withdrawn

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
        id={`post-${post.seq}`}
        className={cn(
          "group flex scroll-mt-20 gap-3 border-b border-hairline py-4 transition-colors duration-700 last:border-b-0 data-[flash=true]:bg-accent-bg/60",
          post.is_solution && "-mx-3 rounded-inner border-b-0 bg-ok-bg px-3"
        )}
      >
        <Avatar
          name={post.author}
          size="lg"
          className={cn(withdrawn && "opacity-50")}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-meta font-medium text-ink">
              {post.author_name}
            </span>
            {post.author_name !== post.author && (
              <span className="text-pill text-mute">@{post.author}</span>
            )}
            {post.author === thread.created_by && !opening && (
              <Pill tone="neutral">Opener</Pill>
            )}
            {post.is_solution && (
              <Pill tone="ok" withDot>
                The answer
              </Pill>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-2 text-pill text-mute tabular-nums">
              {post.edited_at !== null && !withdrawn && (
                <button
                  type="button"
                  onClick={onHistory}
                  title={`Edited ${moment(post.edited_at)} — see what changed`}
                  className="inline-flex items-center gap-1 transition-colors hover:text-ink"
                >
                  <History className="size-3" />
                  edited
                </button>
              )}
              <a
                href={`#post-${post.seq}`}
                title={moment(post.created_at)}
                onClick={(event) => {
                  event.preventDefault()
                  window.history.replaceState(
                    window.history.state,
                    "",
                    `#post-${post.seq}`
                  )
                  onJump(post.seq)
                }}
                className="transition-colors hover:text-ink"
              >
                #{post.seq} · {clock(post.created_at)}
              </a>
            </span>
          </div>

          {post.reply_to !== null && !withdrawn && (
            <button
              type="button"
              onClick={() => {
                if (post.reply_to !== null) onJump(post.reply_to.seq)
              }}
              className="mt-1.5 flex w-full min-w-0 items-center gap-1.5 rounded-inner border-l-2 border-hairline-strong bg-soft px-2.5 py-1 text-left text-meta text-body transition-colors hover:bg-soft-2"
            >
              <CornerUpLeft className="size-3 shrink-0 text-mute" />
              <span className="shrink-0 font-medium text-ink">
                #{post.reply_to.seq} {post.reply_to.author}
              </span>
              <span className="min-w-0 truncate text-mute">
                {post.reply_to.withdrawn ? "withdrawn" : post.reply_to.excerpt}
              </span>
            </button>
          )}

          {withdrawn ? (
            <p className="mt-1.5 text-[0.9375rem] text-mute italic">
              Withdrawn
              {post.withdrawn_by !== null && post.withdrawn_by !== post.author
                ? ` by ${post.withdrawn_by}`
                : " by its author"}
              {post.withdrawn_at !== null && ` ${ago(post.withdrawn_at)}`}.
            </p>
          ) : editing !== null ? (
            <div className="mt-2">
              <PostEditor
                value={editing}
                onChange={onEditChange}
                rows={3}
                people={people}
                me={me}
                autoFocus
                onSubmit={onSaveEdit}
                footer={
                  <>
                    <Button
                      data-cancel
                      variant="ghost"
                      size="sm"
                      onClick={onCancelEdit}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      pending={saving}
                      disabled={
                        editing.trim() === "" || editing.trim() === post.body
                      }
                      onClick={onSaveEdit}
                    >
                      {saving ? "Submitting…" : "Submit"}
                    </Button>
                  </>
                }
              />
            </div>
          ) : (
            <div data-post-body>
              <Markdown text={post.body} me={me} className="mt-1.5" />
            </div>
          )}

          {!withdrawn && editing === null && post.attachments.length > 0 && (
            <PostFiles post={post} />
          )}

          {!withdrawn && editing === null && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {post.reactions.map((reaction) => (
                <button
                  key={reaction.reaction}
                  type="button"
                  disabled={locked || reacting}
                  aria-pressed={reaction.mine}
                  title={reaction.people.join(", ")}
                  onClick={() => onReact(reaction.reaction, !reaction.mine)}
                  className={cn(
                    "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-pill tabular-nums transition-colors disabled:cursor-default",
                    reaction.mine
                      ? "border-accent/40 bg-accent-bg text-accent"
                      : "border-hairline-2 bg-canvas text-body hover:bg-soft-2"
                  )}
                >
                  <span aria-hidden>{reactionEmoji(reaction.reaction)}</span>
                  {reaction.count}
                </button>
              ))}

              {!locked && (
                <Menu.Root>
                  <Menu.Trigger
                    aria-label="React"
                    title="React"
                    className="grid size-6 place-items-center rounded-full text-mute transition-colors hover:bg-soft-2 hover:text-ink"
                  >
                    <SmilePlus className="size-3.5" />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner
                      side="top"
                      align="start"
                      sideOffset={4}
                      className="z-50"
                    >
                      <Menu.Popup
                        className={cn(
                          "flex gap-0.5 rounded-full border border-hairline bg-canvas p-1 shadow-pop",
                          POP_MOTION
                        )}
                      >
                        {REACTIONS.map((reaction) => {
                          const mine =
                            post.reactions.find(
                              (one) => one.reaction === reaction.value
                            )?.mine === true
                          return (
                            <Menu.Item
                              key={reaction.value}
                              title={reaction.label}
                              aria-label={reaction.label}
                              onClick={() => onReact(reaction.value, !mine)}
                              className={cn(
                                "grid size-8 cursor-default place-items-center rounded-full text-[1.0625rem] outline-none data-[highlighted]:bg-soft-2",
                                mine && "bg-accent-bg"
                              )}
                            >
                              {reaction.emoji}
                            </Menu.Item>
                          )
                        })}
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
              )}

              {!locked && (
                <button
                  type="button"
                  // Keep the reader's selection: it is what gets quoted.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onReply}
                  className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-pill font-medium text-mute transition-colors hover:bg-soft-2 hover:text-ink"
                >
                  <CornerUpLeft className="size-3" />
                  Reply
                </button>
              )}

              {canAccept && !post.is_solution && (
                <button
                  type="button"
                  disabled={accepting}
                  onClick={onAccept}
                  className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-pill font-medium text-ok-fg transition-colors hover:bg-ok-bg disabled:opacity-50"
                >
                  <CheckCheck className="size-3" />
                  This answered it
                </button>
              )}

              <Menu.Root>
                <Menu.Trigger
                  aria-label="More"
                  className="ml-auto grid size-6 place-items-center rounded-full text-mute transition hover:bg-soft-2 hover:text-ink"
                >
                  <MoreHorizontal className="size-3.5" />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner
                    side="bottom"
                    align="end"
                    sideOffset={4}
                    className="z-50"
                  >
                    <Menu.Popup
                      className={cn(
                        "min-w-[12rem] rounded-card border border-hairline bg-canvas p-1.5 shadow-pop",
                        POP_MOTION
                      )}
                    >
                      <Menu.Item
                        className={MENU_ITEM}
                        onClick={() =>
                          copyLink(
                            threadLink(post.thread_id, post.seq),
                            `Link to #${post.seq} copied`
                          )
                        }
                      >
                        <Link2 />
                        Copy link to #{post.seq}
                      </Menu.Item>
                      {post.can_edit && (
                        <Menu.Item className={MENU_ITEM} onClick={onEdit}>
                          <Pencil />
                          Edit
                        </Menu.Item>
                      )}
                      {post.revisions > 0 && (
                        <Menu.Item className={MENU_ITEM} onClick={onHistory}>
                          <History />
                          {post.revisions === 1
                            ? "See the edit"
                            : `See ${post.revisions} edits`}
                        </Menu.Item>
                      )}
                      {canAccept && post.is_solution && (
                        <Menu.Item className={MENU_ITEM} onClick={onUnaccept}>
                          <X />
                          Not the answer after all
                        </Menu.Item>
                      )}
                      {post.can_withdraw && (
                        <Menu.Item
                          className={cn(
                            MENU_ITEM,
                            "text-bad-fg [&_svg]:text-bad-fg"
                          )}
                          onClick={onWithdraw}
                        >
                          <Trash2 />
                          Withdraw
                        </Menu.Item>
                      )}
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            </div>
          )}
        </div>
      </article>
    </div>
  )
}

// ---- Opening one -------------------------------------------------------

/// Tags as typed — "Lead time, #harga" — into the words the server will keep.
/// The server normalises again; this is so the chips under the box say what
/// will be saved rather than what was typed.
function splitTags(raw: string): string[] {
  const seen = new Set<string>()
  for (const part of raw.split(",")) {
    const tag = part
      .trim()
      .replace(/^#+/, "")
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word !== "")
      .join("-")
    if (tag !== "" && [...tag].length <= 40) seen.add(tag)
  }
  return [...seen].slice(0, 8)
}

/// Where the unfinished new thread is kept. One per browser, not per record:
/// a question half-written about the wrong order is still the question.
const NEW_THREAD_TITLE = "new-thread-title"
const NEW_THREAD_BODY = "new-thread-body"

/// The threads already open on the record being typed in — Discourse's
/// "your topic is similar to…", made exact: a thread names its record, so a
/// second argument about PO-2607-0108 can be caught before it is opened.
function AlreadyDiscussed({
  kind,
  recordId,
  onOpen,
}: {
  kind: string
  recordId: string
  onOpen: (threadId: string) => void
}) {
  // A record id arrives a keystroke at a time; ask about the one being typed
  // at React's pace, and not before it could be an id at all.
  const typed = useDeferredValue(recordId.trim())
  const asking = kind !== "" && typed.length >= 3
  const filter: ThreadFilter = {
    subjectKind: kind,
    subjectId: typed,
    limit: 5,
  }
  const found = useQuery({
    queryKey: workplaceKeys.threads(filter),
    queryFn: ({ signal }) => listThreads(filter, signal),
    enabled: asking,
  })
  const rows = asking ? (found.data ?? []) : []
  if (rows.length === 0) return null
  return (
    <div className="rounded-inner border border-info-fg/30 bg-soft px-3 py-2.5 md:col-span-2">
      <p className="text-meta font-medium text-ink">
        {rows.length === 1
          ? `There is already a thread about ${typed}.`
          : `There are already ${rows.length} threads about ${typed}.`}{" "}
        <span className="font-normal text-body">
          Adding to one keeps the whole story in one place.
        </span>
      </p>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.thread_id}>
            <button
              type="button"
              onClick={() => onOpen(row.thread_id)}
              className="flex w-full items-center gap-2 rounded-inner px-1.5 py-1 text-left text-meta transition-colors hover:bg-soft-2"
            >
              <span className="min-w-0 flex-1 truncate text-ink">
                {row.title}
              </span>
              <span className="shrink-0 text-pill text-mute">
                {THREAD_STATUS_LABEL[row.status] ?? row.status} ·{" "}
                {ago(row.last_activity_at)}
              </span>
            </button>
          </li>
        ))}
      </ul>
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
    draft.kind !== "" &&
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
  subjectId,
  people,
  onOpened,
}: {
  open: boolean
  onClose: () => void
  /// Prefilled from whatever the board is narrowed to, because that is almost
  /// always what somebody is about to argue about.
  subjectKind: string | null
  subjectId: string | null
  people: readonly Mentionable[]
  onOpened: (threadId: string) => void
}) {
  const client = useQueryClient()
  const me = useIdentity().data?.username
  // The files are uploaded before the thread exists, so they are the upload
  // hook's state rather than the form's: the form holds what is typed.
  const attachments = useAttachments()

  // What was being written the last time this sheet was open, kept until the
  // thread exists. Read once: the form's defaults are its starting point, not
  // a value to keep re-reading while somebody types.
  const [saved] = useState(() => ({
    title: readDraft(NEW_THREAD_TITLE),
    body: readDraft(NEW_THREAD_BODY),
  }))

  // The server's own list of what a thread may hang on, rather than nine words
  // mirrored here: the rail could filter to a kind this form could not offer,
  // and the form opened on a kind its own select did not hold.
  const kinds = useQuery({
    queryKey: workplaceKeys.kinds(),
    queryFn: ({ signal }) => subjectKinds(signal),
    staleTime: Infinity,
    enabled: open,
  })

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
        tags: splitTags(draft.tags),
        attachments: attachments.ids,
      }),
    onSuccess: (thread) => {
      refreshBoard(client)
      attachments.clear()
      writeDraft(NEW_THREAD_TITLE, "")
      writeDraft(NEW_THREAD_BODY, "")
      // Emptied by hand rather than `reset()`: the defaults hold the draft
      // this sheet opened with, and resetting to them would put it back.
      form.setFieldValue("title", "")
      form.setFieldValue("body", "")
      form.setFieldValue("note", "")
      form.setFieldValue("tags", "")
      onClose()
      // Straight into what was just opened: the next thing somebody does
      // after asking is read their own question back, or copy its link.
      onOpened(thread.thread_id)
    },
  })

  const form = useForm({
    defaultValues: {
      kind: subjectKind ?? "",
      recordId: subjectId ?? "",
      title: saved.title,
      body: saved.body,
      note: "",
      tags: "",
    } as ThreadDraft,
    onSubmit: ({ value }) => create.mutate(value),
  })

  const submit = () => {
    if (
      threadReady(form.state.values) &&
      !create.isPending &&
      !attachments.uploading
    ) {
      void form.handleSubmit()
    }
  }

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
                pending={create.isPending}
                disabled={!ready || attachments.uploading}
                onClick={submit}
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
          submit()
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
            <Field label="What it is about" required>
              <Select
                value={field.state.value}
                onChange={(next) => field.handleChange(next)}
              >
                {(kinds.data ?? []).map((kind) => (
                  <option key={kind.kind} value={kind.kind}>
                    {kind.label}
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
              required
              hint="The record's own identifier — PO-2607-0108."
            >
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                maxLength={120}
              />
            </Field>
          )}
        </form.Field>

        <form.Subscribe
          selector={(state) => `${state.values.kind}\n${state.values.recordId}`}
        >
          {(record) => {
            const [kind = "", recordId = ""] = record.split("\n")
            return (
              <AlreadyDiscussed
                kind={kind}
                recordId={recordId}
                onOpen={(threadId) => {
                  onClose()
                  onOpened(threadId)
                }}
              />
            )
          }}
        </form.Subscribe>

        <form.Field name="title">
          {(field) => (
            <Field label="Title" className="md:col-span-2" required>
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.target.value)
                  writeDraft(NEW_THREAD_TITLE, event.target.value)
                }}
                maxLength={200}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="body">
          {(field) => (
            // Not a `<Field>`: that is a `<label>`, and a label forwards every
            // click on its plain parts to the first control inside it — here
            // the editor's Write tab, so clicking the preview flipped it back
            // to the textarea. Same look, drawn without the label.
            <div className="flex flex-col gap-[0.4375rem] md:col-span-2">
              <span className="text-[0.9375rem] font-medium text-text">
                The opening post
                <span aria-hidden className="ml-0.5 text-bad">
                  *
                </span>
                <span className="sr-only"> (required)</span>
              </span>
              <PostEditor
                value={field.state.value}
                onChange={(next) => {
                  field.handleChange(next)
                  writeDraft(NEW_THREAD_BODY, next)
                }}
                label="The opening post"
                rows={7}
                people={people}
                me={me}
                attachments={attachments.pending}
                onAttach={attachments.add}
                onRemoveAttachment={attachments.remove}
                onSubmit={submit}
              />
              <span className="text-[0.9375rem] text-mute">
                A thread with no opening argument is a title.
              </span>
            </div>
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
                maxLength={200}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="tags">
          {(field) => (
            <Field label="Tags" hint="Comma separated, up to eight.">
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {splitTags(field.state.value).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {splitTags(field.state.value).map((tag) => (
                    <TagChip key={tag} tag={tag} />
                  ))}
                </div>
              )}
            </Field>
          )}
        </form.Field>
      </form>
    </Sheet>
  )
}
