import { useEffect, useRef, useState } from "react"

import { getErrorMessage } from "@/lib/api"
import { Icon, paths } from "@/components/dashboard/parts"
import { Avatar, CategoryChip } from "@/components/forum/topic-list"
import {
  ago,
  dayLabel,
  type Category,
  type Post,
  type PostBlock,
  type Topic,
} from "@/components/forum/data"
import { cn } from "@/lib/utils"

function Blocks({ blocks }: { blocks: PostBlock[] }) {
  return (
    <div className="flex flex-col gap-3 text-[13.5px] leading-[1.62] text-ink-2">
      {blocks.map((block, i) => {
        if (block.kind === "p") return <p key={i}>{block.text}</p>
        if (block.kind === "ul")
          return (
            <ul
              key={i}
              className="flex list-disc flex-col gap-1.5 pl-5 marker:text-ink-4"
            >
              {block.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          )
        if (block.kind === "ol")
          return (
            <ol
              key={i}
              className="flex list-decimal flex-col gap-1.5 pl-5 marker:font-mono marker:text-ink-4"
            >
              {block.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ol>
          )
        if (block.kind === "code")
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-panel bg-inset px-3.5 py-3 font-mono text-xs leading-[1.7] text-ink shadow-[inset_0_0_0_1px_var(--line)]"
            >
              {block.text}
            </pre>
          )
        return (
          <blockquote
            key={i}
            className="rounded-r-panel border-l-[3px] border-line-strong bg-inset/60 py-2 pr-3 pl-3.5"
          >
            <div className="pb-1 text-[11.5px] font-semibold text-ink-3">
              {block.author} wrote:
            </div>
            <div className="text-[13px] text-ink-3">{block.text}</div>
          </blockquote>
        )
      })}
    </div>
  )
}

function PostAction({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  count?: number
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-xs font-medium transition-colors duration-[120ms]",
        active ? "text-ember" : "text-ink-4 hover:bg-hover hover:text-ink-2"
      )}
    >
      {icon}
      {count !== undefined && count > 0 && (
        <span className="font-mono tabular-nums">{count}</span>
      )}
    </button>
  )
}

function PostRow({
  post,
  index,
  onLike,
  onReply,
}: {
  post: Post
  index: number
  onLike: () => void
  onReply: () => void
}) {
  return (
    <article className={cn("px-5 py-5", index > 0 && "border-t border-line")}>
      <div className="flex gap-3.5">
        <Avatar
          name={post.author.name}
          hue={post.author.hue}
          size={38}
          className="mt-0.5"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[13.5px] font-semibold text-ink">
              {post.author.name}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-4">
              {ago(post.age)}
            </span>
          </div>

          <div className="pt-2.5">
            <Blocks blocks={post.blocks} />
          </div>

          <div className="-ml-2 flex items-center gap-0.5 pt-3">
            <PostAction
              icon={<Icon path={paths.heart} size={14} width={1.9} />}
              label="Like this post"
              count={post.likes}
              onClick={onLike}
            />
            <PostAction
              icon={<Icon path={paths.link} size={14} width={1.9} />}
              label="Copy link"
            />
            <PostAction
              icon={<Icon path={paths.bookmark} size={14} width={1.9} />}
              label="Bookmark"
            />
            <button
              type="button"
              onClick={onReply}
              className="inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-xs font-medium text-ink-4 transition-colors duration-[120ms] hover:bg-hover hover:text-ink-2"
            >
              <Icon path={paths.reply} size={14} width={1.9} />
              Reply
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

/**
 * The timeline rail. Discourse keeps your place in a long thread here — the
 * first and last dates anchor it, and the thumb shows how far in you are.
 */
function Timeline({ posts, at }: { posts: Post[]; at: number }) {
  const total = posts.length
  if (total === 0) return null
  const index = Math.min(Math.max(at, 0), total - 1)
  const pct = total > 1 ? (index / (total - 1)) * 100 : 0

  return (
    <aside className="hidden w-[132px] shrink-0 flex-col border-l border-line py-5 pr-4 pl-4 lg:flex">
      <div className="font-mono text-[11px] whitespace-nowrap text-ink-4">
        {dayLabel(posts[0].age)}
      </div>

      {/* the track is inset from both labels, so the thumb never overlaps them */}
      <div className="relative my-5 flex-1">
        <span className="absolute inset-y-0 left-0 w-px bg-line-strong" />
        <span
          style={{ top: `${pct}%` }}
          className="absolute left-0 -translate-y-1/2 border-l-2 border-ink pl-3 transition-[top] duration-[220ms] ease-out-strong"
        >
          <span className="block font-mono text-xs leading-tight font-semibold whitespace-nowrap text-ink">
            {index + 1} / {total}
          </span>
          <span className="block font-mono text-[10.5px] leading-tight whitespace-nowrap text-ink-4">
            {dayLabel(posts[index].age)}
          </span>
        </span>
      </div>

      <div className="font-mono text-[11px] whitespace-nowrap text-ink-4">
        {ago(posts[total - 1].age)} ago
      </div>
    </aside>
  )
}

export function TopicView({
  topic,
  category,
  stream,
  loading,
  errorMessage,
  viewerName,
  onRetry,
  onBack,
  onReply,
  onToast,
}: {
  topic: Topic
  category?: Category
  /** The post stream as the backend returned it. */
  stream: Post[]
  loading?: boolean
  errorMessage?: string
  viewerName: string
  onRetry?: () => void
  onBack: () => void
  /** Writes the reply to the record and re-reads the thread. */
  onReply: (body: string) => Promise<void>
  onToast: (message: string) => void
}) {
  // The backing read is the only authority for the stream: a reply is written
  // to the record and then re-read, never merged in locally.
  const posts = stream
  const [at, setAt] = useState(0)
  const [draft, setDraft] = useState("")
  const [composing, setComposing] = useState(false)
  const [sending, setSending] = useState(false)
  const streamRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setAt(0)
  }, [stream])
  const composerRef = useRef<HTMLTextAreaElement>(null)

  /* Reactions exist on the record's comments, but toggling one needs a JWT
   * subject the API-key session has not got — the engine answers 401. So the
   * count is read-only rather than a number this tab invents. */
  const like = () =>
    onToast("Reactions need an operator sign-in; this session has none.")

  const openComposer = () => {
    setComposing(true)
    setTimeout(() => composerRef.current?.focus(), 60)
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await onReply(text)
      setDraft("")
      setComposing(false)
      requestAnimationFrame(() =>
        streamRef.current?.scrollTo({
          top: streamRef.current.scrollHeight,
          behavior: "smooth",
        })
      )
    } catch (error) {
      onToast(getErrorMessage(error))
    } finally {
      setSending(false)
    }
  }

  /** Track which post the reader is nearest, to drive the timeline thumb. */
  const onScroll = () => {
    const el = streamRef.current
    if (!el) return
    const articles = [...el.querySelectorAll("article")]
    const line = el.scrollTop + 120
    let index = 0
    articles.forEach((a, i) => {
      if ((a as HTMLElement).offsetTop <= line) index = i
    })
    setAt(index)
  }

  return (
    <>
      <div className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to topics"
          title="Back to topics"
          className="mt-0.5 grid size-[30px] shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-[120ms] hover:bg-hover hover:text-ink"
        >
          <Icon
            path={paths.chevronRight}
            size={16}
            width={2}
            className="rotate-180"
          />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] leading-[1.3] font-semibold tracking-[-0.015em] text-ink">
            {topic.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-2">
            <CategoryChip category={category} />
            {topic.tags.map((t) => (
              <span key={t} className="text-[11.5px] text-ink-4">
                {t}
              </span>
            ))}
            <span
              title="People watching this record"
              className="flex items-center gap-1 pl-1 font-mono text-[11px] text-ink-4"
            >
              <Icon path={paths.eye} size={12} width={1.9} />
              {topic.watching}
            </span>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={streamRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 [scrollbar-color:var(--line-strong)_transparent] overflow-auto"
        >
          {errorMessage ? (
            <div className="flex h-[200px] flex-col items-center justify-center gap-3 text-center">
              <span className="text-xs text-ember">Unable to load this thread: {errorMessage}</span>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex h-[28px] items-center rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn hover:bg-hover"
                >
                  Retry
                </button>
              )}
            </div>
          ) : posts.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center text-xs text-ink-4">
              {loading ? "Loading posts…" : "No posts in this thread."}
            </div>
          ) : null}

          {posts.map((post, i) => (
            <PostRow
              key={post.id}
              post={post}
              index={i}
              onLike={like}
              onReply={openComposer}
            />
          ))}

          <div className="px-5 py-6">
            {!composing ? (
              <button
                type="button"
                onClick={openComposer}
                className="inline-flex h-[34px] items-center gap-2 rounded-control bg-accent px-3.5 text-[13px] font-medium text-white shadow-[0_1px_2px_rgb(0_134_252/.3)] transition-[filter] duration-[120ms] hover:brightness-105"
              >
                <Icon path={paths.reply} size={15} width={2} />
                Reply
              </button>
            ) : (
              <div className="rounded-card bg-surface shadow-[0_0_0_1px_var(--line-strong),var(--shadow-card)]">
                <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
                  <Avatar name={viewerName} hue="var(--accent)" size={22} />
                  <span className="text-xs font-medium text-ink-2">
                    Replying to{" "}
                    <span className="font-semibold text-ink">
                      {topic.title.slice(0, 42)}…
                    </span>
                  </span>
                </div>
                <textarea
                  ref={composerRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault()
                      void send()
                    }
                  }}
                  placeholder="Share what you found…"
                  className="min-h-[112px] w-full resize-y bg-transparent px-3.5 py-3 text-[13.5px] leading-[1.6] font-medium outline-none placeholder:font-normal placeholder:text-ink-4"
                />
                <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
                  <span className="pl-0.5 font-mono text-[11px] text-ink-4">
                    ⌘⏎ to post
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => {
                      setComposing(false)
                      setDraft("")
                    }}
                    className="inline-flex h-[30px] items-center rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors hover:bg-hover"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={!draft.trim() || sending}
                    className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-accent px-2.5 text-xs font-medium text-white shadow-[0_1px_2px_rgb(0_134_252/.3)] transition-[filter] hover:brightness-105 disabled:pointer-events-none disabled:opacity-45"
                  >
                    <Icon path={paths.reply} size={14} width={2} />
                    {sending ? "Posting…" : "Post reply"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <Timeline posts={posts} at={at} />
      </div>
    </>
  )
}
