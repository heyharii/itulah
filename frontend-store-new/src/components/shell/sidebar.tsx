import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  ArrowUpRight,
  ChevronDown,
  LogOut,
  PanelLeft,
  Store,
  X,
} from "lucide-react"
import { useEffect, useRef } from "react"

import {
  hasSidebar,
  homePath,
  moduleForPath,
  modules,
  newsModule,
  screenForPath,
  tillLink,
  visibleSections,
  type AppModule,
  type NavItem,
} from "@/lib/navigation"
import { useOpenCounts } from "@/lib/counts"
import { useOpenReturns } from "@/lib/returns"
import { unsentCount, useSaleQueue } from "@/lib/sale-queue"
import { node } from "@/lib/api"
import { useIdentity, useNodeIdentity, useSignOut } from "@/lib/session"
import { cn } from "@/lib/utils"

/// One sidebar (v2 design system, direction E · Quiet, airy spacing).
///
/// The dark rail is gone: every module is a row in one light column, and the
/// module you are in unfolds into its screens on a guide line — the shape the
/// hub's Sep-3 brief chose ("satu sidebar, dengan sub-menu"). Which module is
/// open is read from the URL and from nowhere else, so a link opens the
/// sidebar the same way for whoever follows it.
///
/// ⌘B folds the column to its icons rather than hiding it: navigation that
/// disappears has only a shortcut to bring it back. Folded, each row names
/// itself in its `title`.
export function Sidebar({
  variant = "flow",
  folded = false,
  onToggle,
  onClose,
}: {
  variant?: "flow" | "drawer"
  folded?: boolean
  onToggle?: () => void
  onClose?: () => void
}) {
  const drawer = variant === "drawer"
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const current = moduleForPath(pathname)
  const screen = screenForPath(pathname)
  const list = useRef<HTMLElement>(null)
  const where = useNodeIdentity()
  // The shop as the register names it ("C001 · Cikupa"); the node's technical
  // id (store-01) only when the register has not named it.
  // `/health` carries the id only; the register's name for this site comes
  // with `/node/identity`.
  const named = useQuery({
    queryKey: ["node", "named-identity"],
    queryFn: ({ signal }) =>
      node
        .get<{ site_name?: string }>("/api/v1/node/identity", { signal })
        .catch(() => null),
    staleTime: 5 * 60_000,
  })
  const site =
    named.data?.site_name ??
    where.data?.site_id ??
    where.data?.node_id ??
    "This shop"

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>("[data-nav-current]")
      ?.scrollIntoView({ block: "nearest" })
  }, [pathname, folded])

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 shrink-0 flex-col border-r border-hairline bg-soft py-4 transition-[width,padding] duration-(--t-panel) ease-(--ease-out)",
        folded ? "w-[4.75rem] px-2.5" : "w-[16.5rem] px-3.5",
        drawer && "w-[18rem] max-w-[85vw] overflow-y-auto",
      )}
    >
      {/* The shop this device stands in. */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 pb-5",
          folded && "flex-col",
        )}
      >
        <Link
          to={homePath as never}
          aria-label={`${site} — home`}
          title={folded ? site : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-[0.75rem] p-1 transition-colors hover:bg-soft-2",
            folded && "flex-none",
          )}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-[0.625rem] bg-dark text-on-dark shadow-[inset_0_0_0_1px_rgb(255_255_255/8%)]">
            <Store className="size-[1.125rem] stroke-[1.7]" />
          </span>
          {!folded && (
            <span className="min-w-0 flex-1 leading-tight">
              <b className="block truncate text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
                {site}
              </b>
              {where.data?.node_role !== undefined && (
                <span className="block truncate text-meta text-mute">
                  {where.data.node_role.charAt(0)}
                  {where.data.node_role.slice(1).toLowerCase()} server
                </span>
              )}
            </span>
          )}
        </Link>
        {drawer ? (
          <IconButton label="Close navigation" onClick={onClose}>
            <X />
          </IconButton>
        ) : (
          onToggle !== undefined && (
            <IconButton
              label={folded ? "Open the sidebar (⌘B)" : "Fold the sidebar (⌘B)"}
              onClick={onToggle}
            >
              <PanelLeft />
            </IconButton>
          )
        )}
      </div>

      <nav
        ref={list}
        aria-label="Navigation"
        className="flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-0.5 overflow-y-auto pb-2 [&::-webkit-scrollbar]:hidden"
      >
        {modules.map((module) => (
          <ModuleRow
            key={module.id}
            module={module}
            open={module.id === current.id}
            folded={folded}
            activePath={screen?.path}
          />
        ))}
        <hr className="mx-2 my-3 border-0 border-t border-hairline" />
        <TillRow folded={folded} />
        {[newsModule].map((module) => (
          <ModuleRow
            key={module.id}
            module={module}
            open={module.id === current.id}
            folded={folded}
            activePath={screen?.path}
          />
        ))}
      </nav>

      <Account folded={folded} />
    </aside>
  )
}

/// A module: its row, and when it is the open one, its screens under it.
function ModuleRow({
  module,
  open,
  folded,
  activePath,
}: {
  module: AppModule
  open: boolean
  folded: boolean
  activePath: string | undefined
}) {
  const Icon = module.icon
  const unfolds = open && !folded && hasSidebar(module)
  return (
    <div className="flex flex-col">
      <Link
        to={module.home as never}
        title={folded ? module.label : undefined}
        aria-current={open ? "true" : undefined}
        className={cn(
          "group flex h-10 items-center gap-3 rounded-[0.625rem] px-2.5 text-nav font-medium text-text transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:min-h-tap",
          open && "font-semibold text-ink",
          open && !unfolds && "bg-soft-2",
          folded && "justify-center px-0",
        )}
      >
        <Icon
          className={cn(
            "size-[1.125rem] shrink-0 stroke-[1.6] text-line-ico transition-colors group-hover:text-text",
            open && "text-ink",
          )}
        />
        {!folded && (
          <>
            <span className="min-w-0 flex-1 truncate">{module.label}</span>
            {hasSidebar(module) && (
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-faint transition-transform duration-(--t-panel) ease-(--ease-out)",
                  !open && "-rotate-90",
                )}
              />
            )}
          </>
        )}
      </Link>
      {unfolds && <ModuleScreens module={module} activePath={activePath} />}
    </div>
  )
}

/// The till: another app, so it opens in its own tab and says so with the
/// arrow. No row at all when there is nowhere to send anybody.
function TillRow({ folded }: { folded: boolean }) {
  if (tillLink.url === null) return null
  const Icon = tillLink.icon
  return (
    <a
      href={tillLink.url}
      target="_blank"
      rel="noopener"
      title={folded ? `${tillLink.label} (opens in a new tab)` : undefined}
      className={cn(
        "group flex h-10 items-center gap-3 rounded-[0.625rem] px-2.5 text-nav font-medium text-text transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:min-h-tap",
        folded && "justify-center px-0",
      )}
    >
      <Icon className="size-[1.125rem] shrink-0 stroke-[1.6] text-line-ico transition-colors group-hover:text-text" />
      {!folded && (
        <>
          <span className="min-w-0 flex-1 truncate">{tillLink.label}</span>
          <ArrowUpRight className="size-4 shrink-0 text-faint" />
        </>
      )}
    </a>
  )
}

/// The open module's screens, indented on a guide line, without icons: the
/// module's row already carries the picture. A group label (People's Time,
/// Pay, Talent) is a quiet line of its own, never capitals.
export function ModuleScreens({
  module,
  activePath,
}: {
  module: AppModule
  activePath: string | undefined
}) {
  return (
    <div className="nav-swap mt-1 mb-3 ml-[1.3125rem] flex flex-col gap-0.5 border-l-2 border-hairline pl-2.5">
      {visibleSections(module).map((section, index) => (
        <div key={section.label ?? index} className="flex flex-col gap-0.5">
          {section.label !== undefined && (
            <span className="px-2.5 pt-3 pb-1 text-section font-normal text-mute">
              {section.label}
            </span>
          )}
          {section.items.map((item) => (
            <ScreenRow
              key={item.path}
              item={item}
              exact={item.path === module.home}
              active={item.path === activePath}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function ScreenRow({
  item,
  exact,
  active,
}: {
  item: NavItem
  exact: boolean
  active: boolean
}) {
  return (
    <Link
      to={item.path as never}
      activeOptions={{ exact }}
      aria-current={active ? "page" : undefined}
      data-nav-current={active ? "" : undefined}
      className="flex min-h-9 items-center rounded-[0.625rem] px-2.5 text-nav font-medium text-text transition-colors hover:bg-soft-2 hover:text-ink data-[status=active]:bg-soft-2 data-[status=active]:font-semibold data-[status=active]:text-ink pointer-coarse:min-h-tap"
    >
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.path === "/stock/returns" && <ReturnsBadge />}
      {item.path === "/stock/count" && <CountBadge />}
    </Link>
  )
}

function ReturnsBadge() {
  const open = useOpenReturns()
  if (open === 0) return null
  return (
    <span className="ml-2 grid min-w-6 place-items-center rounded-full bg-ink px-1.5 text-meta font-semibold text-canvas">
      {open}
    </span>
  )
}

function CountBadge() {
  const open = useOpenCounts()
  if (open === 0) return null
  return (
    <span className="ml-2 grid min-w-6 place-items-center rounded-full bg-ink px-1.5 text-meta font-semibold text-canvas">
      {open}
    </span>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-9 shrink-0 place-items-center rounded-[0.625rem] text-line-ico transition-colors hover:bg-soft-2 hover:text-text pointer-coarse:size-tap [&_svg]:size-[1.125rem] [&_svg]:stroke-[1.7]"
    >
      {children}
    </button>
  )
}

function Account({ folded }: { folded: boolean }) {
  const identity = useIdentity()
  const signOut = useGuardedSignOut()
  const name = identity.data?.display_name ?? identity.data?.username ?? "—"

  return (
    <div className="mt-auto border-t border-hairline pt-3">
      <div
        className={cn(
          "flex items-center gap-3 rounded-[0.75rem] p-1.5",
          folded && "flex-col gap-2",
        )}
      >
        <span
          title={folded ? name : undefined}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-linear-to-br from-avatar-from to-avatar-to text-meta font-semibold text-ink"
        >
          {name.trim().charAt(0).toUpperCase()}
        </span>
        {!folded && (
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-nav font-semibold text-ink">
              {name}
            </span>
            {identity.data?.role !== undefined && (
              <span className="block truncate text-meta text-mute">
                {identity.data.role.charAt(0)}
                {identity.data.role.slice(1).toLowerCase()}
              </span>
            )}
          </span>
        )}
        <button
          type="button"
          aria-label="Sign out"
          title="Sign out"
          onClick={signOut.run}
          disabled={signOut.pending}
          className="grid size-9 shrink-0 place-items-center rounded-[0.625rem] text-line-ico transition-colors hover:bg-soft-2 hover:text-text disabled:opacity-50 pointer-coarse:size-tap"
        >
          <LogOut className="size-4 stroke-[1.7]" />
        </button>
      </div>
    </div>
  )
}

function useGuardedSignOut() {
  const signOut = useSignOut()
  const unsent = unsentCount(useSaleQueue())
  return {
    pending: signOut.isPending,
    run: () => {
      if (
        unsent > 0 &&
        !window.confirm(
          `${unsent} sale${unsent === 1 ? "" : "s"} on this device ${
            unsent === 1 ? "has" : "have"
          } not reached the node yet. They are saved and will send when the line is back. Sign out anyway?`,
        )
      ) {
        return
      }
      signOut.mutate()
    },
  }
}
