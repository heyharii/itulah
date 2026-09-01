import { Link } from "@tanstack/react-router"

import { Icon, paths } from "@/components/dashboard/parts"
import { IconButton } from "@/components/dashboard/nav-sidebar"
import { AppHeading } from "@/components/app-switcher"
import type { Category, ForumTag } from "@/components/forum/data"
import { cn } from "@/lib/utils"
import { Route } from "@/routes/forum"

const rowClass =
  "flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px] font-medium transition-colors duration-[110ms]"

function SectionLabel({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="mt-3.5 flex h-7 items-center px-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
      {children}
      {action}
    </div>
  )
}

export function ForumSidebar({
  categories,
  tags,
  onCollapse,
  footer,
}: {
  categories: Category[]
  tags: ForumTag[]
  onCollapse: () => void
  footer?: React.ReactNode
}) {
  const { view, category, tag } = Route.useSearch()
  const atRoot = !category && !tag

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-page">
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 pr-2 pl-2.5">
        <AppHeading app="forum" />
        <IconButton label="Collapse sidebar" onClick={onCollapse}>
          <Icon path={paths.panel} size={17} />
        </IconButton>
      </div>

      <nav className="flex-1 overflow-auto px-2 pt-0.5 pb-2">
        {(
          [
            /* Each feed is a filter the records list route itself applies —
             * there is no per-viewer feed to offer, because an API-key session
             * carries no JWT subject for the engine to key one off. */
            { id: "all", label: "All topics", icon: paths.chart },
            { id: "open", label: "Unresolved", icon: paths.edit },
            { id: "priority", label: "High priority", icon: paths.archive },
          ] as const
        ).map((item) => {
          const on = atRoot && view === item.id
          return (
            <Link
              key={item.id}
              from="/forum"
              to="/forum"
              replace
              data-sound="page"
              search={(prev) => ({
                ...prev,
                view: item.id,
                category: undefined,
                tag: undefined,
                open: undefined,
              })}
              className={cn(
                rowClass,
                "group/nav relative text-ink-2 hover:bg-hover hover:text-ink",
                on && "font-semibold text-ink",
                on &&
                  "before:absolute before:top-2 before:bottom-2 before:-left-2 before:w-[2.5px] before:rounded-r-full before:bg-ink before:content-['']"
              )}
            >
              <Icon
                path={item.icon}
                className={cn(
                  "shrink-0 text-ink-4 group-hover/nav:text-ink-2",
                  on && "text-ink-2"
                )}
              />
              {item.label}
            </Link>
          )
        })}

        <SectionLabel>Categories</SectionLabel>
        {categories.length === 0 && (
          <div className="px-2 py-1 text-[11.5px] text-ink-4">
            No topics loaded.
          </div>
        )}
        {categories.map((c) => {
          const on = category === c.id
          return (
            <Link
              key={c.id}
              from="/forum"
              to="/forum"
              replace
              search={(prev) => ({
                ...prev,
                category: on ? undefined : c.id,
                tag: undefined,
                open: undefined,
              })}
              className={cn(
                rowClass,
                "text-ink-2 hover:bg-hover hover:text-ink",
                on && "bg-hover font-semibold text-ink"
              )}
            >
              {/* Discourse marks a category with a solid colour swatch */}
              <span
                style={{ background: c.hue }}
                className="size-3 shrink-0 rounded-[3px]"
              />
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                {c.label}
              </span>
              <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                {c.count}
              </span>
            </Link>
          )
        })}

        <SectionLabel>Tags</SectionLabel>
        {tags.length === 0 && (
          <div className="px-2 py-1 text-[11.5px] text-ink-4">
            No tags in use.
          </div>
        )}
        {tags.map((t) => {
          const on = tag === t.id
          return (
            <Link
              key={t.id}
              from="/forum"
              to="/forum"
              replace
              search={(prev) => ({
                ...prev,
                tag: on ? undefined : t.id,
                category: undefined,
                open: undefined,
              })}
              className={cn(
                rowClass,
                "text-ink-2 hover:bg-hover hover:text-ink",
                on && "bg-hover font-semibold text-ink"
              )}
            >
              <Icon
                path={paths.tag}
                size={14}
                width={1.9}
                className="shrink-0 text-ink-4"
              />
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                {t.label}
              </span>
              <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                {t.count}
              </span>
            </Link>
          )
        })}
      </nav>

      {footer && <div className="shrink-0 p-2">{footer}</div>}
    </aside>
  )
}
