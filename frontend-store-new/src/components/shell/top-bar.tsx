import { useQuery } from "@tanstack/react-query"
import { Link, useRouter, useRouterState } from "@tanstack/react-router"
import { ArrowLeft, BellRing, Menu, RefreshCw } from "lucide-react"

import { sync } from "@/lib/api"
import { useGo } from "@/lib/go"
import { moduleForPath, screenForPath, visibleSections } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import { syncHealth } from "@itulah/contract/client"

/// The bar over the page: where you are, and the two things about this node
/// worth a glance from anywhere.
///
/// The hub's bar (`frontend-hub/src/components/shell/top-bar.tsx`): the
/// breadcrumb on a desk, the screen's own title on a phone. The right-hand
/// tools are the till's — whether the node is reaching head office, and how
/// many sales are still only on this device — in place of the console's clock,
/// bell and assistant.
export function TopBar({ onOpenNav }: { onOpenNav?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const module = moduleForPath(pathname)
  const screen = screenForPath(pathname)
  // A hidden screen — the payment step, a product's card — names the row it
  // was reached from, so the crumb reads Counter / Sell / Payment.
  const parent =
    screen?.hidden === true && screen.back !== undefined
      ? visibleSections(module)
          .flatMap((section) => section.items)
          .find((item) => item.path === screen.back)
      : undefined

  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-hairline bg-canvas px-5 max-md:px-3">
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

      {/* A phone has room for one line: the screen's name, under the module's. */}
      <div className="flex min-w-0 flex-1 flex-col justify-center md:hidden">
        <span className="text-meta leading-none font-medium text-mute">
          {module.label}
        </span>
        <h1 className="truncate text-[1rem] leading-tight font-semibold text-ink">
          {screen?.label ?? module.label}
        </h1>
      </div>

      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-2 text-nav font-medium max-md:hidden"
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
      className="-ml-1.5 grid size-tap shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
    >
      <ArrowLeft className="size-[1.125rem] stroke-[1.7]" />
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

/// Whether this node is reaching head office. The till sells either way; this
/// is what tells somebody that the day's figures have not left the building.
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
      className="inline-flex h-8 items-center gap-2 rounded-inner px-2.5 text-nav font-medium text-body transition-colors hover:bg-soft-2 hover:text-ink"
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
