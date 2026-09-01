import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { Faces } from "@/components/collaboration/person"
import { LiveBadge } from "@/components/collaboration/live-badge"
import { NewThread } from "@/components/discussion/new-thread"
import { StatusPill, SubjectChip } from "@/components/discussion/parts"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ago } from "@/lib/collaboration"
import {
  listThreads,
  subjectCounts,
  subjectCountsKey,
  subjectLabel,
  threadsKey,
  useDiscussionEvents,
  type ThreadFilter,
} from "@/lib/discussion"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Bookmark, Plus, Tag } from "lucide-react"
import { useMemo, useRef, useState } from "react"

/// What the list is showing, in the URL rather than in a variable.
///
/// The same argument the draft purchase order made: a filtered list somebody
/// wants a colleague to look at is a link, and a reload should not throw the
/// filter away. It also makes the back button mean what it looks like it
/// means.
export interface DiscussionSearch {
  readonly feed?: "bookmarked" | "mine"
  readonly kind?: string
  readonly tag?: string
  readonly status?: string
  readonly q?: string
}

/// Discussions: arguments that hang on records.
///
/// The left-hand axis is subject kinds, not categories, and that is the whole
/// difference from a forum. `subject_kind` has nine values and every one of
/// them is a thing this business does — so the useful question a reader asks
/// here ("what is being argued about on purchase orders") is a filter the data
/// can actually answer, rather than a folder somebody remembered to file in.
export function DiscussionsView() {
  const navigate = useNavigate()
  const search = useSearch({ from: "/discussions" })
  const [opening, setOpening] = useState(false)
  useDiscussionEvents()

  const filter: ThreadFilter = useMemo(
    () => ({
      feed: search.feed,
      subjectKind: search.kind,
      tag: search.tag,
      status: search.status,
      q: search.q,
    }),
    [search.feed, search.kind, search.tag, search.status, search.q],
  )

  const threads = useQuery({
    queryKey: threadsKey(filter),
    queryFn: ({ signal }) => listThreads(filter, signal),
  })
  const subjects = useQuery({
    queryKey: subjectCountsKey(),
    queryFn: ({ signal }) => subjectCounts(signal),
  })

  const rows = useMemo(() => threads.data ?? [], [threads.data])

  /// Only the threads on screen are drawn.
  ///
  /// `/api/v1/discussions` answers with every thread that matches — there is no
  /// paging on it — so an unfiltered list on a busy month is a few thousand
  /// rows, each carrying a stack of faces and chips. Heights are measured
  /// rather than assumed: a thread with a preview line is taller than one
  /// without, and rows that overlapped would be worse than a slow list.
  const scroller = useRef<HTMLDivElement>(null)
  const list = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 92,
    overscan: 8,
    getItemKey: (index) => rows[index].thread_id,
  })

  // Tags come from the threads on screen, because the server counts subjects
  // and not tags. Said plainly rather than dressed up as a global tag cloud:
  // this is what the current list is tagged with.
  const tags = useMemo(() => {
    const counted = new Map<string, number>()
    for (const thread of rows) {
      for (const tag of thread.tags) counted.set(tag, (counted.get(tag) ?? 0) + 1)
    }
    return [...counted.entries()].sort((left, right) => left[0].localeCompare(right[0]))
  }, [rows])

  const go = (next: Partial<DiscussionSearch>) =>
    void navigate({
      to: "/discussions",
      search: (previous: DiscussionSearch) => ({ ...previous, ...next }),
    })

  const heading =
    search.kind !== undefined
      ? subjectLabel(search.kind)
      : search.tag !== undefined
        ? `#${search.tag}`
        : search.feed === "bookmarked"
          ? "Bookmarked"
          : search.feed === "mine"
            ? "Mine"
            : "Discussions"

  return (
    <AppShell
      nav={<Nav />}
      facets={
        <div className="flex flex-col gap-4">
          <Facet title="Feed">
            <FacetRow
              label="All"
              active={search.feed === undefined}
              onClick={() => go({ feed: undefined })}
            />
            <FacetRow
              label="Mine"
              active={search.feed === "mine"}
              onClick={() => go({ feed: search.feed === "mine" ? undefined : "mine" })}
            />
            <FacetRow
              label="Bookmarked"
              icon={<Bookmark className="size-3.5" />}
              active={search.feed === "bookmarked"}
              onClick={() =>
                go({ feed: search.feed === "bookmarked" ? undefined : "bookmarked" })
              }
            />
            {/* The prototype also drew "Following" and "Mentions me". Neither
                exists on the wire, and a tab that filtered nothing would be
                worse than its absence. */}
          </Facet>

          <Facet title="Status">
            {["open", "resolved", "locked"].map((status) => (
              <FacetRow
                key={status}
                label={status === "resolved" ? "Answered" : status === "open" ? "Open" : "Locked"}
                active={search.status === status}
                onClick={() => go({ status: search.status === status ? undefined : status })}
              />
            ))}
          </Facet>

          <Facet title="Subject">
            {(subjects.data ?? []).length === 0 ? (
              <p className="text-muted-foreground px-2 text-[11px]">
                {subjects.isPending ? "Loading…" : "Nothing open."}
              </p>
            ) : (
              (subjects.data ?? []).map((count) => (
                <FacetRow
                  key={count.subject_kind}
                  label={subjectLabel(count.subject_kind)}
                  count={count.threads}
                  active={search.kind === count.subject_kind}
                  onClick={() =>
                    go({
                      kind: search.kind === count.subject_kind ? undefined : count.subject_kind,
                      tag: undefined,
                    })
                  }
                />
              ))
            )}
          </Facet>

          {tags.length > 0 && (
            <Facet title="Tag">
              {tags.map(([tag, count]) => (
                <FacetRow
                  key={tag}
                  label={tag}
                  count={count}
                  icon={<Tag className="size-3.5" />}
                  active={search.tag === tag}
                  onClick={() =>
                    go({ tag: search.tag === tag ? undefined : tag, kind: undefined })
                  }
                />
              ))}
            </Facet>
          )}
        </div>
      }
    >
      <ScreenHeader
        title={heading}
        subtitle={
          threads.isPending
            ? "loading…"
            : `${rows.length} thread${rows.length === 1 ? "" : "s"}`
        }
      >
        <Input
          value={search.q ?? ""}
          onChange={(event) =>
            go({ q: event.target.value === "" ? undefined : event.target.value })
          }
          placeholder="Search titles, records, tags"
          className="hidden h-8 w-56 text-xs sm:block"
        />
        <LiveBadge />
        <Button size="sm" onClick={() => setOpening(true)}>
          <Plus className="size-3.5" />
          New
        </Button>
      </ScreenHeader>

      <NewThread open={opening} onOpenChange={setOpening} />

      {threads.isPending ? (
        <ScreenState>Loading discussions…</ScreenState>
      ) : threads.isError ? (
        <ScreenState
          tone="problem"
          action={
            <Button size="sm" variant="outline" onClick={() => void threads.refetch()}>
              Try again
            </Button>
          }
        >
          {threads.error instanceof ApiError
            ? threads.error.message
            : "The discussions could not be loaded."}
        </ScreenState>
      ) : rows.length === 0 ? (
        <ScreenState
          action={
            <Button size="sm" onClick={() => setOpening(true)}>
              Start one
            </Button>
          }
        >
          Nothing here. A discussion hangs off a record — a purchase order, a
          supplier, one receipt — so start it from the thing being argued
          about.
        </ScreenState>
      ) : (
        <ScreenBody>
          <div className="text-muted-foreground flex shrink-0 items-center gap-3 border-b px-3.5 py-2 text-[11px]">
            <span className="min-w-0 flex-1">{rows.length} discussions</span>
            <span className="w-14 shrink-0 text-right">Replies</span>
            {/* The field counts distinct people who opened the thread, not
                page loads. So the column says people. */}
            <span
              className="w-14 shrink-0 text-right"
              title="Distinct people who have opened this thread, not page views"
            >
              People
            </span>
            <span className="hidden w-20 shrink-0 text-right sm:block">Activity</span>
          </div>
          <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
            <ul className="relative w-full" style={{ height: list.getTotalSize() }}>
              {list.getVirtualItems().map((item) => {
                const thread = rows[item.index]
                return (
                  <li
                    key={item.key}
                    data-index={item.index}
                    ref={list.measureElement}
                    className="absolute top-0 left-0 w-full"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    <Link
                      to="/discussions/$threadId"
                      params={{ threadId: thread.thread_id }}
                      className="hover:bg-[var(--os-soft,#f7f7f8)] flex w-full items-start gap-3 border-b px-3.5 py-3 text-left transition-colors"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="mb-1 flex flex-wrap items-baseline gap-2">
                          <span className="text-[13.5px] font-medium">{thread.title}</span>
                          {thread.status !== "open" && <StatusPill status={thread.status} />}
                          {thread.has_solution && thread.status === "open" && (
                            <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600">
                              Answered
                            </span>
                          )}
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <SubjectChip
                            kind={thread.subject_kind}
                            subjectId={thread.subject_id}
                          />
                          {thread.subject_note !== null && (
                            <span className="text-muted-foreground text-[11px]">
                              {thread.subject_note}
                            </span>
                          )}
                          {thread.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-muted-foreground rounded-full border px-1.5 py-0.5 text-[10px]"
                            >
                              {tag}
                            </span>
                          ))}
                          <Faces people={thread.voices} />
                        </span>
                        {thread.latest_post_preview !== null && (
                          <span className="text-muted-foreground mt-1 block truncate text-[11.5px]">
                            {thread.latest_post_preview}
                          </span>
                        )}
                      </span>
                      {thread.bookmarked_by_me && (
                        <Bookmark className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                      )}
                      <span className="w-14 shrink-0 pt-0.5 text-right font-mono text-[13px] tabular-nums">
                        {thread.reply_count}
                      </span>
                      <span className="w-14 shrink-0 pt-0.5 text-right font-mono text-[13px] tabular-nums">
                        {thread.people}
                      </span>
                      <span className="text-muted-foreground hidden w-20 shrink-0 pt-1 text-right text-[11px] sm:block">
                        {ago(thread.last_activity_at)}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        </ScreenBody>
      )}
    </AppShell>
  )
}

function Facet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-1 px-2 text-[0.78125rem] font-medium text-[var(--os-mute,#a6a6ad)]">
        {title}
      </h2>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function FacetRow({
  label,
  count,
  icon,
  active,
  onClick,
}: {
  label: string
  count?: number
  icon?: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "hover:bg-muted flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[0.8125rem] transition-colors",
        active && "bg-[var(--os-soft-2,#f3f3f5)] text-[var(--os-ink,#1d1d1f)]",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="text-muted-foreground font-mono text-[10px]">{count}</span>
      )}
    </button>
  )
}
