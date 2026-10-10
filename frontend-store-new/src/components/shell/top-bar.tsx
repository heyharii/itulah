import { useQuery } from "@tanstack/react-query"
import { Link, useRouter, useRouterState } from "@tanstack/react-router"
import { BellRing, ChevronLeft, Menu, RefreshCw } from "lucide-react"

import { sync } from "@/lib/api"
import { useGo } from "@/lib/go"
import { initialOf } from "@/lib/format"
import { moduleForPath, screenForPath, visibleSections } from "@/lib/navigation"
import { useIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"
import { syncHealth } from "@itulah/contract/client"

/// The bar over the page: where you are, and the two things about this node
/// worth a glance from anywhere — the hub's bar
/// (`frontend-hub/src/components/shell/top-bar.tsx`).
///
/// On a tablet it is the breadcrumb, read left to right, and a short row of
/// tools at the far end (docked, the breadcrumb goes — the rail, the panel and
/// the page's own title already say where you are): whether the node is reaching head office, and the
/// bell (Discuss). On the page's own grey, separated by a hairline, so it is
/// part of the page it names and not a second strip of chrome.
///
/// On a phone it holds the title and the person, nothing else but the same two
/// tools (owner, 2026-10-06): ONE title — the screen's name, once; the module's
/// name is not repeated above it — the sync dot, the bell, and a circle with the
/// person's initial that opens the navigation drawer, where the account lives.
/// The way back from a hidden screen is a chevron before the title.
export function TopBar({
  onOpenNav,
  onOpenAccount,
}: {
  /// The tablet's menu button: there is a drawer to open and no rail.
  onOpenNav?: () => void
  /// The phone's profile circle: opens the same drawer.
  onOpenAccount?: () => void
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const module = moduleForPath(pathname)
  const screen = screenForPath(pathname)
  // A hidden screen — a record opened from another screen — names the row it
  // was reached from, so the crumb reads Stock / Count / Session.
  const parent =
    screen?.hidden === true && screen.back !== undefined
      ? visibleSections(module)
          .flatMap((section) => section.items)
          .find((item) => item.path === screen.back)
      : undefined
  const title = screen?.label ?? module.label

  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-hairline bg-soft-3 px-5 max-md:bg-canvas max-md:px-3">
      {onOpenNav && screen?.hidden !== true && (
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open navigation"
          className="-ml-1.5 grid size-tap shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
        >
          <Menu className="size-[1.125rem] stroke-[1.7]" />
        </button>
      )}
      {screen?.hidden === true && (
        <BackButton to={screen.back ?? module.home} />
      )}

      {/* A phone has room for one line: the screen's name, once. */}
      <h1 className="flex min-h-11 min-w-0 flex-1 items-center truncate text-[1.0625rem] leading-tight font-semibold text-ink md:hidden">
        <span className="truncate">{title}</span>
      </h1>

      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-2 text-[0.875rem] font-medium max-md:hidden lg:hidden"
      >
        <Link
          to={module.home as never}
          className="inline-flex shrink-0 items-center gap-[0.4375rem] text-body transition-colors hover:text-ink"
        >
          <module.icon className="size-[0.9375rem] stroke-[1.7] text-line-ico" />
          {module.label}
        </Link>
        {parent !== undefined && parent.label !== module.label && (
          <>
            <span aria-hidden className="text-faint">
              /
            </span>
            <Link
              to={parent.path as never}
              className="shrink-0 text-body transition-colors hover:text-ink"
            >
              {parent.label}
            </Link>
          </>
        )}
        {screen !== undefined && screen.label !== module.label && (
          <>
            <span aria-hidden className="text-faint">
              /
            </span>
            <span
              aria-current="page"
              className="inline-flex min-w-0 items-center gap-[0.4375rem] font-semibold text-ink"
            >
              <screen.icon className="size-[0.9375rem] shrink-0 stroke-[1.7] text-line-ico" />
              <span className="truncate">{screen.label}</span>
            </span>
          </>
        )}
      </nav>

      {/* Docked (from 64rem) the rail and the panel say where you are and the
          page opens with its own title, so the bar is only its tools — the
          hub's slim desk strip. */}
      <span className="flex-1 max-lg:hidden" />

      <div className="flex shrink-0 items-center gap-2">
        <SyncChip />
        <Link
          to={"/news" as never}
          title="Discuss with head office"
          aria-label="Discuss"
          aria-current={module.id === "news" ? "page" : undefined}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-text pointer-coarse:size-tap",
            module.id === "news" && "bg-soft-2 text-ink",
          )}
        >
          <BellRing className="size-[1.0625rem] stroke-[1.55]" />
        </Link>
        {onOpenAccount && <ProfileButton onClick={onOpenAccount} />}
      </div>
    </header>
  )
}

function BackButton({ to }: { to: string }) {
  const router = useRouter()
  const go = useGo()
  return (
    <button
      type="button"
      aria-label="Back"
      onClick={() => {
        if (router.history.canGoBack()) router.history.back()
        else go(to)
      }}
      className="-ml-2 grid size-tap shrink-0 place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-text active:bg-soft-2"
    >
      <ChevronLeft className="size-5" />
    </button>
  )
}

/// The person, at the top of a phone's screen: the account is opened rarely,
/// so it takes the corner a thumb reaches last, and the bottom bar keeps to
/// what is pressed all day. A circle with the initial, as phones draw an
/// account — 32px to see, 44px to press.
function ProfileButton({ onClick }: { onClick: () => void }) {
  const identity = useIdentity()
  const name = identity.data?.display_name ?? identity.data?.username ?? ""
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Account and navigation"
      aria-haspopup="dialog"
      className="relative grid size-8 shrink-0 place-items-center rounded-full bg-accent-bg text-[0.875rem] font-semibold text-accent transition-[scale] duration-(--t-press) ease-(--ease-out) select-none after:absolute after:-inset-1.5 after:content-[''] active:scale-[0.92] md:hidden"
    >
      {initialOf(name)}
    </button>
  )
}

const SYNC_DOT = {
  current: "bg-ok",
  behind: "bg-warn",
  blocked: "bg-bad",
  off: "bg-faint",
} as const

const SYNC_WORD = {
  current: "Synced",
  behind: "Sending",
  blocked: "Stuck",
  off: "Sync off",
} as const

/// Whether this node is reaching head office. The shop works either way; this
/// is what tells somebody that the day's figures have not left the building.
/// A dot on a phone, the dot and the word on a desk.
function SyncChip() {
  const status = useQuery({
    queryKey: ["sync", "status"],
    queryFn: ({ signal }) => sync.status(signal),
    refetchInterval: 15_000,
  })
  const health = status.data === undefined ? null : syncHealth(status.data)
  return (
    <Link
      to={"/node/sync" as never}
      title="Sync with head office"
      aria-label={
        health === null ? "Sync with head office" : `Sync: ${SYNC_WORD[health]}`
      }
      className="relative inline-flex h-8 items-center gap-2 rounded-inner px-2.5 text-[0.875rem] font-medium text-body transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-soft-2 hover:text-ink"
    >
      {health === null ? (
        <RefreshCw className="size-[0.875rem] stroke-[1.7] text-line-ico" />
      ) : (
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", SYNC_DOT[health])}
        />
      )}
      <span className="max-md:hidden">
        {health === null ? "Sync" : SYNC_WORD[health]}
      </span>
    </Link>
  )
}
