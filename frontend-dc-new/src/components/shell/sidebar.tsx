import { Link, useRouterState } from "@tanstack/react-router"
import { LogOut, Search, WifiOff } from "lucide-react"

import { AppLink } from "@/components/ui/app-link"

import { stationForPath } from "@/lib/navigation"
import { useWaiting } from "@/lib/queries/waiting"
import { useIdentity, useNodeIdentity, useSignOut } from "@/lib/session"
import { cn } from "@/lib/utils"

/// The 248px sidebar — the screens within the station the rail selected.
///
/// It carries what the (hidden) top bar used to: the station chip at the head,
/// the account at the foot. Two things differ from the hub's:
///
///  - The chip says what the station **does**, not just what it is called.
///    A warehouse hires people who have never seen the app before lunch, and
///    "Choose the store, fill the box, seal it" is worth 248 pixels.
///  - Every row can carry a count. The rail says a station has work; this says
///    which screen it is on.
///
/// Rows are 44px because they are pressed with a thumb, in a glove, on a
/// tablet bolted to a bay.
export function Sidebar({
  open,
  onOpenPalette,
}: {
  open: boolean
  onOpenPalette: () => void
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const active = stationForPath(pathname)
  const identity = useIdentity()
  const where = useNodeIdentity()
  const waiting = useWaiting()
  const signOut = useSignOut()

  return (
    <aside
      data-open={open}
      className={cn(
        "flex w-[15.5rem] shrink-0 flex-col border-r border-hairline bg-soft px-[0.6875rem] py-[0.8125rem]",
        "min-h-0 transition-[margin] duration-200",
        // Collapsing slides it out rather than unmounting it: the nav keeps
        // its scroll position, and a re-mount would re-run every badge query.
        !open && "-ml-[15.5rem]"
      )}
    >
      {/* The station chip — takes over what the top bar used to carry. */}
      <button
        type="button"
        onClick={onOpenPalette}
        className="mb-2.5 flex min-h-tap items-center gap-2 rounded-inner p-1.5 text-left transition-colors hover:bg-soft-2"
      >
        <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-lg bg-ink text-white">
          <Search className="size-[0.875rem]" />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[0.90625rem] font-semibold tracking-[-0.015em]">
            {active.label}
          </b>
          <small className="block truncate text-[0.6875rem] font-normal text-mute">
            {active.does}
          </small>
        </span>
      </button>

      <nav
        aria-label={active.label}
        className="flex min-h-0 flex-col gap-px overflow-y-auto"
      >
        {active.sections.map((section, index) => (
          <div key={section.label ?? index} className="flex flex-col gap-px">
            {section.label && (
              <div className="px-[0.5625rem] pt-1.5 pb-[0.4375rem] text-[0.6875rem] font-semibold tracking-[0.05em] text-mute uppercase">
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const Icon = item.icon
              const count = item.waiting?.(waiting) ?? 0
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  activeOptions={{ exact: item.path === active.home }}
                  className="group flex min-h-tap items-center gap-2.5 rounded-lg px-[0.5625rem] py-[0.4375rem] text-nav font-medium text-text transition-colors hover:bg-soft-2 data-[status=active]:bg-soft-2 data-[status=active]:text-ink"
                >
                  {/* Active is signalled by the pale pill plus the icon going
                      solid — never by a heavier weight. */}
                  <Icon className="size-[1.0625rem] shrink-0 stroke-[1.55] text-line-ico group-data-[status=active]:text-ink" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-[0.4375rem] py-px text-[0.625rem] font-semibold tabular-nums",
                        item.tone === "bad" && "bg-bad-bg text-bad-fg",
                        item.tone === "info" && "bg-info-bg text-info-fg",
                        (item.tone === "warn" || item.tone === undefined) &&
                          "bg-warn-bg text-warn-fg"
                      )}
                    >
                      {count > 999 ? "999+" : count}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-px pt-2.5">
        {/* A node with authentication switched off is a fact somebody has to
            be able to see: on such a node every write is attributed to
            whoever the bench says is standing at it, and receiving cannot be
            completed at all unless two different names are given. Said here
            rather than left to be discovered by a refused count. */}
        {where.data?.auth === "DISABLED" && (
          <AppLink
            to="/node/account"
            className="mb-1.5 flex min-h-tap items-center gap-2 rounded-inner bg-warn-bg px-2.5 py-2 text-[0.71875rem] font-medium text-warn-fg"
          >
            <WifiOff className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              Sign-in is off on this node — name the bench
            </span>
          </AppLink>
        )}
        <div className="flex min-h-tap items-center gap-2.5 rounded-inner border border-hairline p-[0.4375rem_0.5rem]">
          <span className="size-[1.625rem] shrink-0 rounded-full bg-linear-to-br from-avatar-from to-avatar-to" />
          <span className="min-w-0 flex-1 text-[0.78125rem] leading-tight font-medium">
            <span className="block truncate">
              {identity.data?.display_name ?? identity.data?.username ?? "—"}
            </span>
            <small className="block truncate text-[0.6875rem] font-normal text-mute">
              {where.data?.site_id ?? where.data?.node_id ?? "this node"}
            </small>
          </span>
          <button
            type="button"
            aria-label="Sign out"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="grid size-[1.875rem] shrink-0 place-items-center rounded-lg text-line-ico transition-colors hover:bg-soft-2 hover:text-text disabled:opacity-50"
          >
            <LogOut className="size-4 stroke-[1.7]" />
          </button>
        </div>
      </div>
    </aside>
  )
}
