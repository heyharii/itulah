import { useMemo, useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import { Switch } from "@/components/dashboard/nav-sidebar"
import { ForumSidebar } from "@/components/forum/forum-sidebar"
import { TopicList } from "@/components/forum/topic-list"
import { TopicView } from "@/components/forum/topic-view"
import { NewTopicSheet } from "@/components/forum/new-topic-sheet"
import {
  useCreateTopic,
  usePostReply,
  useForumOverview,
  useTopicPosts,
  participantFor,
  FORUM_ACTOR,
  type NewTopicInput,
} from "@/components/forum/api"
import {
  cue,
  readSoundPreference,
  useInteractionSounds,
  writeSoundPreference,
} from "@/components/dashboard/use-interaction-sounds"
import { cn } from "@/lib/utils"
import { Route } from "@/routes/forum"
import {
  AppShell,
  AppShellSidebar,
  SidebarTrigger,
} from "@/components/app-shell"

interface Toast {
  id: number
  message: string
}

export function Forum() {
  const { view, sort, category, tag, open: openId } = Route.useSearch()
  const query = Route.useSearch({ select: (search) => search.q ?? "" })
  const navigate = Route.useNavigate()

  const [railHidden, setRailHidden] = useState(false)
  const [soundOn, setSoundOn] = useState(readSoundPreference)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [composing, setComposing] = useState(false)

  const overview = useForumOverview(view)
  const categories = overview.data?.categories ?? []
  const tags = overview.data?.tags ?? []
  const directory = overview.data?.directory
  /* The records engine takes its viewer from JWT claims and this session
   * authenticates by API key, so the only identity it can honestly show for
   * the composer is the actor id the proxy writes on every request. */
  const viewerName = directory?.get(FORUM_ACTOR) ?? FORUM_ACTOR

  useInteractionSounds(soundOn)

  const toast = (message: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message }])
    cue("success")
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }

  const topicList = useMemo(() => overview.data?.topics ?? [], [overview.data])

  const topics = useMemo(() => {
    let out = topicList
    if (category) out = out.filter((t) => t.category === category)
    if (tag) out = out.filter((t) => t.tags.includes(tag))

    const needle = query.trim().toLowerCase()
    if (needle)
      out = out.filter(
        (t) =>
          t.title.toLowerCase().includes(needle) ||
          t.tags.some((x) => x.includes(needle))
      )

    const ranked = [...out]
    // The records engine has no pinning and no ordering hint, so these three
    // orders are computed from the counters it does return.
    if (sort === "top") ranked.sort((a, b) => b.replies - a.replies)
    else if (sort === "new") ranked.sort((a, b) => a.created - b.created)
    else ranked.sort((a, b) => a.activity - b.activity)
    return ranked
  }, [topicList, category, tag, query, sort])

  const openTopic = topicList.find((t) => t.id === openId) ?? null
  const openCategory = categories.find((c) => c.id === openTopic?.category)
  const postsResource = useTopicPosts(
    openTopic ? openTopic.id : null,
    directory
  )
  const postReplyMutation = usePostReply()
  const createTopicMutation = useCreateTopic()

  /*
   * Variables-based optimism (§M3): the reply appears in exactly one place,
   * the stream the reader is already looking at, so the pending row is built
   * straight from the mutation's own `variables` and `isPending` rather than
   * patched into the cache. It carries a placeholder id and "just now" — both
   * discarded the moment the real post lands from `onSettled`'s refetch, so
   * neither is a value ever written back to the server or the cache (§M5).
   */
  const pendingPost = useMemo(() => {
    if (
      !postReplyMutation.isPending ||
      !directory ||
      postReplyMutation.variables?.topicId !== openTopic?.id
    )
      return null
    return {
      id: "pending-reply",
      author: participantFor(FORUM_ACTOR, directory),
      age: 0,
      blocks: [{ kind: "p" as const, text: postReplyMutation.variables.body }],
      likes: 0,
    }
  }, [postReplyMutation.isPending, postReplyMutation.variables, directory, openTopic])

  /* Stable identity matters: TopicView keys its scroll state off this. */
  const postsData = postsResource.data
  const stream = useMemo(
    () => (pendingPost ? [...(postsData ?? []), pendingPost] : (postsData ?? [])),
    [postsData, pendingPost]
  )

  /* The write owns its own cache effect (§M1): both the thread and the row's
   * reply counter changed, so `usePostReply` invalidates the whole forum
   * namespace on settle. This screen never calls `invalidateQueries` itself. */
  const reply = async (body: string) => {
    if (!openTopic) return
    await postReplyMutation.mutateAsync({ topicId: openTopic.id, body })
    toast("Reply posted")
  }

  const create = async (input: NewTopicInput) => {
    const id = await createTopicMutation.mutateAsync(input)
    setComposing(false)
    if (id) {
      void navigate({
        search: () => ({ view: "all", sort: "latest", open: id }),
      })
    }
    toast("Topic opened")
  }

  return (
    <AppShell
      label="Forum navigation"
      railWidth={236}
      cols={
        railHidden
          ? "grid-cols-[0px_minmax(0,1fr)]"
          : "grid-cols-[236px_minmax(0,1fr)]"
      }
    >
      <AppShellSidebar className={cn(railHidden && "invisible")}>
        <ForumSidebar
          categories={categories}
          tags={tags}
          onCollapse={() => setRailHidden((v) => !v)}
          footer={
            <button
              type="button"
              role="switch"
              aria-checked={soundOn}
              data-sound-silent
              onClick={() => {
                const next = !soundOn
                setSoundOn(next)
                writeSoundPreference(next)
                if (next) cue("toggle")
              }}
              className="flex h-[34px] w-full items-center gap-[9px] rounded-control px-2 text-xs font-medium text-ink-2 transition-colors duration-[120ms] hover:bg-hover hover:text-ink"
            >
              <Icon path={paths.sound} className="shrink-0 text-ink-4" />
              Interaction sounds
              <Switch on={soundOn} />
            </button>
          }
        />
      </AppShellSidebar>

      <main
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-hidden py-2 pr-2 max-lg:pl-2",
          railHidden && "pl-2"
        )}
      >
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-surface shadow-card">
          {/* header — identity, search, and the one thing you came to do */}
          <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 pr-2.5 pl-3.5">
            <div className="flex min-w-0 items-baseline gap-2">
              <SidebarTrigger className="-ml-1 self-center" />
              <h1 className="text-sm font-semibold tracking-[-0.01em]">
                {openTopic ? "Topic" : "Latest"}
              </h1>
              {!openTopic && (
                <span className="font-mono text-[11.5px] text-ink-4">
                  {overview.isLoading && !overview.data
                    ? "…"
                    : `${topics.length} topic${topics.length === 1 ? "" : "s"}`}
                </span>
              )}
            </div>

            <div className="flex items-center gap-[7px]">
              <label className="inline-flex h-[30px] items-center gap-[7px] rounded-control bg-field px-[9px] text-ink-4 shadow-[inset_0_0_0_1px_var(--line)] transition-[box-shadow,background-color] duration-[130ms] focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
                <Icon path={paths.search} size={14} width={1.9} />
                <input
                  value={query}
                  onChange={(e) => {
                    void navigate({
                      search: (prev) => ({
                        ...prev,
                        q: e.target.value || undefined,
                        open: undefined,
                      }),
                      replace: true,
                    })
                  }}
                  placeholder="Search topics…"
                  aria-label="Search topics"
                  className="w-[150px] text-xs font-medium placeholder:text-ink-4"
                />
              </label>
              <button
                type="button"
                onClick={() => setComposing(true)}
                className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-accent px-2.5 text-xs font-medium text-white shadow-[0_1px_2px_rgb(0_134_252/.3)] transition-[filter] duration-[120ms] hover:brightness-105"
              >
                <Icon path={paths.plus} size={14} width={2.1} />
                New topic
              </button>
            </div>
          </div>

          {openTopic ? (
            <TopicView
              key={openTopic.id}
              topic={openTopic}
              category={openCategory}
              stream={stream}
              loading={postsResource.isLoading}
              errorMessage={postsResource.errorMessage}
              viewerName={viewerName}
              onRetry={postsResource.reload}
              onBack={() =>
                void navigate({
                  search: (prev) => ({ ...prev, open: undefined }),
                  replace: true,
                })
              }
              onReply={reply}
              onToast={toast}
            />
          ) : (
            <TopicList
              topics={topics}
              categories={categories}
              tags={tags}
              loading={overview.isLoading}
              errorMessage={overview.errorMessage}
              onRetry={overview.reload}
            />
          )}
        </div>
      </main>

      <NewTopicSheet
        open={composing}
        categories={categories}
        tags={tags}
        onClose={() => setComposing(false)}
        onCreate={create}
      />

      <div className="fixed right-4 bottom-4 z-90 flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex animate-pop items-center gap-2.5 rounded-panel bg-surface px-3.5 py-2.5 text-xs font-medium shadow-[0_0_0_1px_var(--line-strong),var(--shadow-overlay)]"
          >
            <Icon
              path={paths.check}
              size={15}
              width={2.2}
              className="text-grass"
            />
            {t.message}
          </div>
        ))}
      </div>
    </AppShell>
  )
}
