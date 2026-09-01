import { Link } from "@tanstack/react-router"

import { Icon, paths } from "@/components/dashboard/parts"
import { IconButton } from "@/components/dashboard/nav-sidebar"
import { AppHeading } from "@/components/app-switcher"
import {
  STORAGE_TOTAL,
  STORAGE_USED,
  formatSize,
} from "@/components/files/data"
import { cn } from "@/lib/utils"
import { Route } from "@/routes/files"

export type Scope = "drive" | "shared" | "recent" | "starred" | "trash"

const SCOPES: { id: Scope; label: string; icon: React.ReactNode }[] = [
  { id: "drive", label: "My Drive", icon: paths.folder },
  { id: "shared", label: "Shared with me", icon: paths.people },
  { id: "recent", label: "Recent", icon: paths.clock },
  { id: "starred", label: "Starred", icon: paths.star },
  { id: "trash", label: "Trash", icon: paths.trash },
]

export function FilesSidebar({
  scopes,
  counts,
  onCollapse,
  onNew,
  newDisabled = false,
  showStorage = true,
  footer,
}: {
  /** Which scopes the active source can actually answer. cloud-hub's library
   *  has no favourites, sharing or trash, so those are withheld when live. */
  scopes?: Scope[]
  counts: Record<Scope, number>
  onCollapse: () => void
  onNew: () => void
  newDisabled?: boolean
  showStorage?: boolean
  footer?: React.ReactNode
}) {
  const { scope } = Route.useSearch()
  const pct = Math.min(100, (STORAGE_USED / STORAGE_TOTAL) * 100)
  const shown = scopes ? SCOPES.filter((s) => scopes.includes(s.id)) : SCOPES

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-page">
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 pr-2 pl-2.5">
        <AppHeading app="files" />
        <IconButton label="Collapse sidebar" onClick={onCollapse}>
          <Icon path={paths.panel} size={17} />
        </IconButton>
      </div>

      {/* the one prominent action, the way Drive leads with it */}
      <div className="px-2 pb-1.5">
        <button
          type="button"
          onClick={onNew}
          disabled={newDisabled}
          title={
            newDisabled
              ? "cloud-hub's document library has no folder table, so folders cannot be created"
              : undefined
          }
          className="flex h-[38px] w-full items-center gap-2 rounded-control bg-accent px-3 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgb(0_134_252/.3)] transition-[filter] duration-[120ms] hover:brightness-105 disabled:pointer-events-none disabled:opacity-45"
        >
          <Icon path={paths.plus} size={16} width={2.2} />
          New
        </button>
      </div>

      <nav className="flex-1 overflow-auto px-2 pb-2">
        {shown.map((s) => {
          const on = scope === s.id
          return (
            <Link
              key={s.id}
              from="/files"
              to="/files"
              replace
              data-sound="page"
              search={(prev) => ({
                ...prev,
                scope: s.id,
                q: undefined,
                folder: s.id === "drive" ? undefined : prev.folder,
                open: undefined,
              })}
              className={cn(
                "group/nav relative flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px] font-medium transition-colors duration-[110ms]",
                "text-ink-2 hover:bg-hover hover:text-ink",
                on && "bg-hover font-semibold text-ink"
              )}
            >
              <Icon
                path={s.icon}
                className={cn(
                  "shrink-0 text-ink-4 group-hover/nav:text-ink-2",
                  on && "text-ink-2"
                )}
              />
              {s.label}
              <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                {counts[s.id]}
              </span>
            </Link>
          )
        })}
      </nav>

      {showStorage && (
        <div className="shrink-0 px-3.5 pt-1 pb-3">
          <div className="h-1 overflow-hidden rounded-full bg-inset">
            <div
              style={{ width: `${pct}%` }}
              className="h-full rounded-full bg-accent"
            />
          </div>
          <div className="pt-1.5 text-[11px] text-ink-4">
            {formatSize(STORAGE_USED)} of {formatSize(STORAGE_TOTAL)} used
          </div>
        </div>
      )}

      {footer && <div className="shrink-0 p-2">{footer}</div>}
    </aside>
  )
}
