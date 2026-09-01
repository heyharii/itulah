import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import {
  ago,
  compact,
  type Category,
  type ForumTag,
  type Topic,
} from "@/components/forum/data"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"
import { Route } from "@/routes/forum"

const TOPIC_COLUMNS = "minmax(0,1fr) 132px 82px 78px 88px"

/** A person's initial in a circle — the forum's unit of "who". */
export function Avatar({
  name,
  hue,
  size = 24,
  className,
}: {
  name: string
  hue: string
  size?: number
  className?: string
}) {
  return (
    <span
      title={name}
      style={{
        background: hue,
        width: size,
        height: size,
        fontSize: size * 0.42,
      }}
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-white uppercase select-none",
        className
      )}
    >
      {name[0]}
    </span>
  )
}

/** The category swatch + name, exactly as it reads under a topic title. */
export function CategoryChip({ category }: { category?: Category }) {
  if (!category) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2">
      <span
        style={{ background: category.hue }}
        className="size-[9px] shrink-0 rounded-[2px]"
      />
      {category.label}
    </span>
  )
}

function Dropdown({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ink-2 shadow-btn transition-colors duration-[120ms] hover:bg-hover hover:text-ink"
    >
      {label}
      <Icon
        path={paths.chevronDown}
        size={12}
        width={2}
        className="text-ink-4"
      />
    </button>
  )
}

interface TopicListProps {
  topics: Topic[]
  categories: Category[]
  tags: ForumTag[]
  loading?: boolean
  errorMessage?: string
  onRetry?: () => void
}

export function TopicList({
  topics,
  categories,
  tags,
  loading,
  errorMessage,
  onRetry,
}: TopicListProps) {
  const { sort, category, tag } = Route.useSearch()
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const scope = category
    ? categoryById.get(category)?.label
    : tag
      ? `#${tags.find((t) => t.id === tag)?.label ?? tag}`
      : null

  /* No cell in this row carries its own click, so there is nothing to give
   * VirtualRows as `onRowClick` — but the whole row still highlights on
   * hover, which needs its own state since that highlight has to reach every
   * cell, not just whichever one the pointer is over. */
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const hoverProps = (id: string) => ({
    onMouseEnter: () => setHoveredId(id),
    onMouseLeave: () => setHoveredId((current) => (current === id ? null : current)),
  })

  return (
    <>
      {/* filter bar — dropdowns on the left, sort tabs beside them */}
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3.5">
        <Dropdown label="Categories" />
        <Dropdown label="Tags" />

        <div
          role="tablist"
          className="ml-1 flex items-center gap-0.5 rounded-control bg-inset p-0.5"
        >
          {(
            [
              { id: "latest", label: "Latest" },
              { id: "top", label: "Top" },
              { id: "new", label: "New" },
            ] as const
          ).map((s) => {
            const on = s.id === sort
            return (
              <Link
                key={s.id}
                from="/forum"
                to="/forum"
                replace
                role="tab"
                aria-selected={on}
                search={(prev) => ({ ...prev, sort: s.id })}
                className={cn(
                  "inline-flex h-[25px] items-center rounded-[7px] px-[11px] text-xs font-medium transition-[background-color,color,box-shadow] duration-[130ms]",
                  on
                    ? "bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--line-strong),0_1px_2px_rgb(18_18_18/.05)]"
                    : "text-ink-3 hover:text-ink-2"
                )}
              >
                {s.label}
              </Link>
            )
          })}
        </div>

        {scope && (
          <Link
            from="/forum"
            to="/forum"
            replace
            search={(prev) => ({
              ...prev,
              category: undefined,
              tag: undefined,
            })}
            className="ml-auto inline-flex h-[26px] items-center gap-1.5 rounded-control bg-accent-tint px-2 text-xs font-medium text-accent-ink transition-colors hover:brightness-[0.97]"
          >
            {scope}
            <Icon path={paths.close} size={11} width={2.4} />
          </Link>
        )}
      </div>

      <div className="min-h-0 flex-1 [scrollbar-color:var(--line-strong)_transparent] [scrollbar-gutter:stable] overflow-auto">
        <VirtualRows
          rows={topics}
          rowKey={(topic) => topic.id}
          columns={TOPIC_COLUMNS}
          rowHeight={60}
          className="min-w-[640px]"
          empty={
            errorMessage ? (
              <div className="flex h-[200px] flex-col items-center justify-center gap-3 text-center">
                <span className="text-xs text-ember">
                  Unable to load topics: {errorMessage}
                </span>
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
            ) : (
              <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-ink-4">
                <span className="grid size-[34px] place-items-center rounded-panel bg-inset shadow-[inset_0_0_0_1px_var(--line-strong)]">
                  <Icon path={paths.search} size={17} />
                </span>
                <span className="text-xs">
                  {loading ? "Loading topics…" : "No topics in this scope yet."}
                </span>
              </div>
            )
          }
          header={
            <>
              <span className="text-left">Topic</span>
              <span />
              <span className="text-right">Replies</span>
              <span className="text-right">Watching</span>
              <span className="text-right">Activity</span>
            </>
          }
          renderRow={(topic) => {
            const hovered = hoveredId === topic.id
            return (
              <>
                <span
                  role="gridcell"
                  {...hoverProps(topic.id)}
                  className={cn(
                    "self-stretch py-2.5 pr-3 pl-3.5 transition-colors duration-[120ms]",
                    hovered && "bg-hover"
                  )}
                >
                  <Link
                    from="/forum"
                    to="/forum"
                    search={(prev) => ({ ...prev, open: topic.id })}
                    className={cn(
                      "block w-full text-left text-[14px] leading-[1.4] font-medium text-ink transition-colors",
                      hovered && "text-accent-ink"
                    )}
                  >
                    <span className="inline-flex items-baseline gap-1.5">
                      {topic.title}
                      {topic.terminal && (
                        <span className="inline-flex translate-y-px items-center gap-1 rounded-chip bg-green-tint px-1.5 py-px text-[10.5px] font-semibold text-green">
                          <Icon path={paths.check} size={9} width={3.4} />
                          {topic.statusLabel}
                        </span>
                      )}
                    </span>
                  </Link>

                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1.5">
                    <CategoryChip category={categoryById.get(topic.category)} />
                    {topic.tags.map((t) => (
                      <span key={t} className="text-[11.5px] text-ink-4">
                        {t}
                      </span>
                    ))}
                  </div>
                </span>

                {/* the faces that carried the thread */}
                <span
                  role="gridcell"
                  {...hoverProps(topic.id)}
                  className={cn(
                    "self-stretch px-2 transition-colors duration-[120ms]",
                    hovered && "bg-hover"
                  )}
                >
                  <div className="flex h-full items-center gap-1">
                    {topic.participants.slice(0, 4).map((p) => (
                      <Avatar key={p.id} name={p.name} hue={p.hue} />
                    ))}
                  </div>
                </span>

                <span
                  role="gridcell"
                  {...hoverProps(topic.id)}
                  className={cn(
                    "flex items-center justify-end self-stretch px-3 font-mono text-xs text-ink-2 tabular-nums transition-colors duration-[120ms]",
                    hovered && "bg-hover"
                  )}
                >
                  {topic.replies}
                </span>
                <span
                  role="gridcell"
                  {...hoverProps(topic.id)}
                  className={cn(
                    "flex items-center justify-end self-stretch px-3 font-mono text-xs text-ink-2 tabular-nums transition-colors duration-[120ms]",
                    hovered && "bg-hover"
                  )}
                >
                  {compact(topic.watching)}
                </span>
                <span
                  role="gridcell"
                  {...hoverProps(topic.id)}
                  className={cn(
                    "flex items-center justify-end self-stretch px-3.5 font-mono text-xs text-ink-4 tabular-nums transition-colors duration-[120ms]",
                    hovered && "bg-hover"
                  )}
                >
                  {ago(topic.activity)}
                </span>
              </>
            )
          }}
        />
      </div>
    </>
  )
}
