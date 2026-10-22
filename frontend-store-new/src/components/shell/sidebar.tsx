import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import { ArrowUpRight, ChevronRight, LogOut, PanelLeft, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { confirm } from "@/components/ui/confirm"
import { BrandMark } from "@/components/brand-mark"
import { useOpenCounts } from "@/lib/counts"
import { node } from "@/lib/api"
import {
  hasSidebar,
  homePath,
  isShopModule,
  moduleForPath,
  modules,
  newsModule,
  screenForPath,
  tillLink,
  visibleSections,
  type AppModule,
  type NavItem,
} from "@/lib/navigation"
import { useOpenReturns } from "@/lib/returns"
import { unsentCount, useSaleQueue } from "@/lib/sale-queue"
import { useIdentity, useNodeIdentity, useSignOut } from "@/lib/session"
import { cn } from "@/lib/utils"

/// The shop this device stands in, as the register names it ("C001 · Cikupa");
/// the node's technical id (store-01) only when the register has not named it.
/// `/health` carries the id only; the register's name for this site comes with
/// `/node/identity`.
// eslint-disable-next-line react-refresh/only-export-components -- read by the rail, the panel and the drawer alike
export function useSite(): string {
  const where = useNodeIdentity()
  const named = useQuery({
    queryKey: ["node", "named-identity"],
    queryFn: ({ signal }) =>
      node
        .get<{ site_name?: string }>("/api/v1/node/identity", { signal })
        .catch(() => null),
    staleTime: 5 * 60_000,
  })
  return (
    named.data?.site_name ??
    where.data?.site_id ??
    where.data?.node_id ??
    "This shop"
  )
}

/// Signing out, with a word of warning while sales are still only on this
/// device: they are saved and will send when the line is back, but the person
/// signing out should know it.
// eslint-disable-next-line react-refresh/only-export-components -- one rule for the rail and the drawer
export function useGuardedSignOut() {
  const signOut = useSignOut()
  const unsent = unsentCount(useSaleQueue())
  return {
    pending: signOut.isPending,
    run: async () => {
      if (
        unsent > 0 &&
        !(await confirm({
          title: "Sign out anyway?",
          body: `${unsent} sale${unsent === 1 ? "" : "s"} on this device ${
            unsent === 1 ? "has" : "have"
          } not reached the node yet. They are saved and will send when the line is back.`,
          action: "Sign out",
          destructive: true,
        }))
      ) {
        return
      }
      signOut.mutate()
    },
  }
}

/// The module whose screens the light panel shows for this path, or `null`
/// when it has none to show — a module with one screen has no panel, because a
/// panel of one row that repeats the icon you just pressed is an echo.
// eslint-disable-next-line react-refresh/only-export-components -- the shell and the panel both read it
export function useSubSidebar(): AppModule | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const module = moduleForPath(pathname)
  return isShopModule(module) && hasSidebar(module) ? module : null
}

/// The light column between the rail and the page: the module you are in, its
/// label on the head and its screens down the body — the hub's `SubSidebar`
/// (`frontend-hub/src/components/shell/sub-sidebar.tsx`).
///
/// Canvas, hairlines and the accent for the row you are on — the panel reads as
/// part of the page, exactly so the charcoal rail reads as the one place that
/// answers the bigger question. The head is the rail brand's height, so the
/// three lower edges — rail, panel, page — are one line across the window.
/// `onFold` puts the fold in that head (⌘B); while the panel stands it is the
/// only fold affordance, and when it is away the rail takes the panel back. At
/// the foot, the shop this device stands in.
export function SubSidebar({
  module,
  onFold,
}: {
  module: AppModule
  onFold: () => void
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const screen = screenForPath(pathname)
  const list = useRef<HTMLDivElement>(null)
  const site = useSite()
  const where = useNodeIdentity()

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>("[data-nav-current]")
      ?.scrollIntoView({ block: "nearest" })
  }, [pathname])

  return (
    <nav
      aria-label={module.label}
      className="shell-panel flex h-full w-[14.5rem] shrink-0 flex-col border-r border-hairline bg-canvas"
    >
      <div className="flex h-13 shrink-0 items-center gap-1 border-b border-hairline pr-2 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
          {module.label}
        </h2>
        <button
          type="button"
          onClick={onFold}
          aria-label="Hide the screens"
          title="Hide the screens  ⌘B"
          className="grid size-8 shrink-0 place-items-center rounded-inner text-mute transition-colors hover:bg-soft-2 hover:text-ink"
        >
          <PanelLeft className="size-[1.0625rem] stroke-[1.6]" />
        </button>
      </div>
      {/* Keyed on the module so its screens rise into place when the rail moves
          you between modules (`nav-swap`), and are left alone when a row inside
          is clicked. */}
      <div
        key={module.id}
        ref={list}
        className="nav-swap flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2.5"
      >
        <ScreenRows module={module} activePath={screen?.path} tone="panel" />
      </div>
      <div className="flex h-13 shrink-0 items-center gap-2.5 border-t border-hairline px-4">
        <span className="min-w-0 flex-1 leading-tight">
          <b className="block truncate text-[0.875rem] font-medium text-ink">
            {site}
          </b>
          {where.data?.node_role !== undefined && (
            <span className="block truncate text-[0.875rem] text-mute">
              {where.data.node_role.charAt(0)}
              {where.data.node_role.slice(1).toLowerCase()} server
            </span>
          )}
        </span>
      </div>
    </nav>
  )
}

/// Which surface the rows are drawn on: the light panel, or the charcoal
/// drawer (the rail's full-width form). One row logic, two palettes — the lit
/// row and the counts cannot be allowed to drift between the two columns that
/// show them.
type Tone = "panel" | "rail"

const TONE = {
  panel: {
    row: "min-h-9 rounded-inner text-body hover:bg-soft-2 hover:text-ink",
    on: "data-[status=active]:bg-accent-bg data-[status=active]:font-medium data-[status=active]:text-accent",
    label: "text-mute",
    count: "bg-ink text-canvas",
  },
  rail: {
    row: "min-h-[2.125rem] rounded-[0.4375rem] text-rail-text hover:bg-rail-2 hover:text-rail-ink",
    on: "data-[status=active]:bg-rail-3 data-[status=active]:font-medium data-[status=active]:text-rail-ink",
    label: "text-rail-mute",
    count: "bg-rail-3 text-rail-ink",
  },
} as const

/// A module's screens, one row each; a group label (People's Time, Pay, Talent)
/// is a quiet line of its own, never capitals.
function ScreenRows({
  module,
  activePath,
  tone,
  touch = false,
}: {
  module: AppModule
  activePath: string | undefined
  tone: Tone
  /// Under a thumb: 44px rows and 15px type.
  touch?: boolean
}) {
  return (
    <>
      {visibleSections(module).map((section, index) => (
        <div key={section.label ?? index} className="flex flex-col gap-0.5">
          {section.label !== undefined && (
            <span
              className={cn(
                "px-2.5 pt-3 pb-1 text-[0.875rem]",
                TONE[tone].label,
              )}
            >
              {section.label}
            </span>
          )}
          {section.items.map((item) => (
            <ScreenRow
              key={item.path}
              item={item}
              exact={item.path === module.home}
              active={item.path === activePath}
              tone={tone}
              touch={touch}
            />
          ))}
        </div>
      ))}
    </>
  )
}

function ScreenRow({
  item,
  exact,
  active,
  tone,
  touch,
}: {
  item: NavItem
  exact: boolean
  active: boolean
  tone: Tone
  touch: boolean
}) {
  const t = TONE[tone]
  return (
    <Link
      to={item.path as never}
      activeOptions={{ exact }}
      aria-current={active ? "page" : undefined}
      data-nav-current={active ? "" : undefined}
      className={cn(
        "flex shrink-0 items-center px-2.5 text-[0.875rem] transition-colors pointer-coarse:min-h-tap",
        t.row,
        t.on,
        touch && "min-h-11 rounded-[0.625rem] px-3 text-[0.9375rem]",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.path === "/stock/returns" && <ReturnsBadge tone={tone} />}
      {item.path === "/stock/count" && <CountBadge tone={tone} />}
    </Link>
  )
}

function Badge({ open, tone }: { open: number; tone: Tone }) {
  if (open === 0) return null
  return (
    <span
      className={cn(
        "ml-2 grid min-w-6 place-items-center rounded-full px-1.5 text-[0.875rem] font-semibold",
        TONE[tone].count,
      )}
    >
      {open}
    </span>
  )
}

function ReturnsBadge({ tone }: { tone: Tone }) {
  return <Badge open={useOpenReturns()} tone={tone} />
}

function CountBadge({ tone }: { tone: Tone }) {
  return <Badge open={useOpenCounts()} tone={tone} />
}

/// The navigation as a drawer — under 64rem, and behind the phone's More tab:
/// the hub's `NavColumn` in its drawer form, charcoal, rows with their words,
/// the module you are in opened beneath its row, because a drawer has no panel
/// to hold the screens and icons alone would be a memory test.
export function DrawerNav({ onClose }: { onClose: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const current = moduleForPath(pathname)
  const screen = screenForPath(pathname)
  const site = useSite()
  const where = useNodeIdentity()
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>("[data-nav-current]")
      ?.scrollIntoView({ block: "nearest" })
  }, [pathname])

  return (
    <nav
      aria-label="Navigation"
      className="flex h-full w-[18rem] max-w-[85vw] shrink-0 flex-col bg-rail pt-[env(safe-area-inset-top,0px)] text-rail-text"
    >
      <div className="flex h-13 shrink-0 items-center gap-1 border-b border-rail-hair px-3">
        <Link
          to={homePath as never}
          aria-label={`${site} — home`}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-inner p-1 transition-colors hover:bg-rail-2"
        >
          <BrandMark className="size-7" />
          <span className="min-w-0 flex-1 leading-tight">
            <b className="block truncate text-[0.9375rem] font-semibold tracking-[-0.01em] text-rail-ink">
              {site}
            </b>
            {where.data?.node_role !== undefined && (
              <span className="block truncate text-[0.875rem] text-rail-mute">
                {where.data.node_role.charAt(0)}
                {where.data.node_role.slice(1).toLowerCase()} server
              </span>
            )}
          </span>
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="grid size-tap shrink-0 place-items-center rounded-inner text-rail-mute transition-colors hover:bg-rail-2 hover:text-rail-ink"
        >
          <X className="size-[1.125rem] stroke-[1.7]" />
        </button>
      </div>

      <div
        ref={list}
        className="flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-0.5 overflow-y-auto px-3 pt-3 pb-3 [&::-webkit-scrollbar]:hidden"
      >
        {/* The module you are in is always listed, even one the rail keeps
            out (People, GA): its screens are rows beneath it. */}
        {(modules.includes(current) || !isShopModule(current)
          ? modules
          : [...modules, current]
        ).map((module) => (
          <DrawerModule
            key={module.id}
            module={module}
            open={module.id === current.id}
            activePath={screen?.path}
          />
        ))}
      </div>

      <div className="flex shrink-0 flex-col gap-0.5 border-t border-rail-hair px-3 pt-2 pb-2.5">
        <DrawerLink
          to={newsModule.home}
          icon={newsModule.icon}
          label={newsModule.label}
          lit={current.id === newsModule.id}
        />
        {tillLink.url !== null && (
          <DrawerLink
            href={tillLink.url}
            icon={tillLink.icon}
            label={tillLink.label}
          />
        )}
        <DrawerAccount />
      </div>
    </nav>
  )
}

/// A module's row, and — when it is the one you are in and has screens of its
/// own — those screens beneath it on a guide line. A module that is one screen
/// is a link to it.
function DrawerModule({
  module,
  open,
  activePath,
}: {
  module: AppModule
  open: boolean
  activePath: string | undefined
}) {
  const Icon = module.icon
  const folds = hasSidebar(module)
  // The module you are in can be folded shut and opened again: pressing its row
  // while it is open folds it instead of navigating. Forgotten once you leave.
  const [shut, setShut] = useState(false)
  if (!open && shut) setShut(false)
  const expanded = open && folds && !shut

  return (
    <>
      <Link
        to={module.home as never}
        aria-expanded={folds ? expanded : undefined}
        onClick={(event) => {
          if (!open || !folds) return
          event.preventDefault()
          setShut(!shut)
        }}
        className={cn(
          "group flex min-h-11 shrink-0 items-center gap-3 rounded-inner px-2.5 text-[0.9375rem] transition-colors",
          open && !folds
            ? "bg-rail-3 font-medium text-rail-ink"
            : open
              ? "font-medium text-rail-ink"
              : "text-rail-text hover:bg-rail-2 hover:text-rail-ink",
        )}
      >
        <Icon
          className={cn(
            "size-[1.125rem] shrink-0 stroke-[1.6] transition-colors",
            open
              ? "text-rail-ink"
              : "text-rail-mute group-hover:text-rail-text",
          )}
        />
        <span className="min-w-0 flex-1 truncate">{module.label}</span>
        {folds && (
          <ChevronRight
            className={cn(
              "size-4 shrink-0 stroke-[1.7] text-rail-mute transition-transform duration-(--t-panel) ease-(--ease-out)",
              expanded && "rotate-90",
            )}
          />
        )}
      </Link>
      {expanded && (
        // Keyed on the module so its screens rise into place when it opens
        // (`nav-swap`), and are left alone when a row inside is clicked.
        <div
          key={module.id}
          className="nav-swap mt-0.5 mb-2 ml-[1.1875rem] flex flex-col gap-px border-l border-rail-hair pl-2"
        >
          <ScreenRows
            module={module}
            activePath={activePath}
            tone="rail"
            touch
          />
        </div>
      )}
    </>
  )
}

/// A row that is one place: Discuss, or another app.
function DrawerLink({
  to,
  href,
  icon: Icon,
  label,
  lit = false,
}: {
  to?: string
  href?: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  lit?: boolean
}) {
  const className = cn(
    "group flex min-h-11 shrink-0 items-center gap-3 rounded-inner px-2.5 text-[0.9375rem] transition-colors",
    lit
      ? "bg-rail-3 font-medium text-rail-ink"
      : "text-rail-text hover:bg-rail-2 hover:text-rail-ink",
  )
  const icon = (
    <Icon
      className={cn(
        "size-[1.125rem] shrink-0 stroke-[1.6] transition-colors",
        lit ? "text-rail-ink" : "text-rail-mute group-hover:text-rail-text",
      )}
    />
  )
  if (href !== undefined)
    return (
      <a href={href} target="_blank" rel="noopener" className={className}>
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ArrowUpRight className="size-4 shrink-0 text-rail-mute" />
      </a>
    )
  return (
    <Link
      to={(to ?? homePath) as never}
      aria-current={lit ? "page" : undefined}
      className={className}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Link>
  )
}

/// The person, and the way out.
function DrawerAccount() {
  const identity = useIdentity()
  const signOut = useGuardedSignOut()
  const name = identity.data?.display_name ?? identity.data?.username ?? "—"
  const initial = name.trim().charAt(0).toUpperCase() || "?"
  return (
    <div className="mt-1 flex items-center gap-1">
      <div className="flex h-11 min-w-0 flex-1 items-center gap-2.5 px-1.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-rail-3 text-[0.875rem] font-semibold text-rail-ink shadow-[inset_0_0_0_1px_var(--rail-hair)]">
          {initial}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[0.875rem] font-medium text-rail-ink">
            {name}
          </span>
          {identity.data?.role !== undefined && (
            <span className="block truncate text-[0.875rem] text-rail-mute">
              {identity.data.role.charAt(0)}
              {identity.data.role.slice(1).toLowerCase()}
            </span>
          )}
        </span>
      </div>
      <button
        type="button"
        aria-label="Sign out"
        title="Sign out"
        onClick={signOut.run}
        disabled={signOut.pending}
        className="grid size-tap shrink-0 place-items-center rounded-inner text-rail-mute transition-colors hover:bg-rail-2 hover:text-rail-ink disabled:opacity-50"
      >
        <LogOut className="size-4 stroke-[1.7]" />
      </button>
    </div>
  )
}
