import { Link, useRouterState } from "@tanstack/react-router"
import { LogOut, X } from "lucide-react"

import { Mark } from "@/components/shell/mark"
import {
  homePath,
  moduleForPath,
  visibleSections,
  type AppModule,
  type NavItem,
} from "@/lib/navigation"
import { unsentCount, useSaleQueue } from "@/lib/sale-queue"
import { useIdentity, useNodeIdentity, useSignOut } from "@/lib/session"
import { cn } from "@/lib/utils"

/// The light column beside the rail: *which screen of it*.
///
/// The hub's sidebar (`frontend-hub/src/components/shell/sidebar.tsx`) — the
/// workspace chip at the bar's height, the module's name as the column's
/// title, its screens under it, the person at the foot — with the till's
/// workspace in the chip: which shop this is and which node is answering.
export function Sidebar({
  variant = "flow",
  onClose,
}: {
  variant?: "flow" | "drawer"
  onClose?: () => void
}) {
  const drawer = variant === "drawer"
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const module = moduleForPath(pathname)
  const where = useNodeIdentity()
  const site = where.data?.site_id ?? where.data?.node_id ?? "This till"

  return (
    <aside
      className={cn(
        "flex h-full w-[15.5rem] shrink-0 flex-col border-r border-hairline bg-soft px-[0.6875rem] py-[0.8125rem]",
        "min-h-0",
        drawer && "max-w-[calc(85vw-5rem)] overflow-y-auto",
      )}
    >
      {/* The workspace, at the bar's height so its lower edge and the bar's
          are one line across the window. */}
      <div className="-mx-[0.1875rem] -mt-[0.8125rem] flex h-13 shrink-0 items-center gap-1 border-b border-hairline">
        <Link
          to={homePath as never}
          aria-label={`${site} — home`}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-inner px-1.5 py-1 transition-colors hover:bg-soft-2"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-[0.4375rem] bg-dark text-on-dark shadow-[inset_0_0_0_1px_rgb(255_255_255/8%)]">
            <Mark className="h-[1.125rem] w-4" />
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <b className="block truncate text-[0.8125rem] font-semibold tracking-[-0.01em] text-ink">
              {site}
            </b>
            {where.data?.node_role !== undefined && (
              <span className="block truncate text-[0.6875rem] text-mute">
                {where.data.node_role.toLowerCase()} · {where.data.node_id}
              </span>
            )}
          </span>
        </Link>
        {drawer && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            title="Close"
            className="grid size-tap shrink-0 place-items-center rounded-lg text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
          >
            <X className="size-[1.125rem] stroke-[1.7]" />
          </button>
        )}
      </div>

      {/* Keyed like the list below, so both swap together when the rail
          moves and are left alone when a row is clicked. */}
      <b
        key={`title:${module.id}`}
        className="nav-swap mt-3.5 mb-1.5 block truncate px-[0.5625rem] text-card-title font-semibold tracking-[-0.01em] text-ink"
      >
        {module.label}
      </b>

      <nav
        key={`list:${module.id}`}
        aria-label="Navigation"
        className="nav-swap flex min-h-0 [scrollbar-width:none] flex-col gap-px overflow-y-auto [&::-webkit-scrollbar]:hidden"
      >
        <ModuleScreens module={module} />
      </nav>

      <Account />
    </aside>
  )
}

export function ModuleScreens({ module }: { module: AppModule }) {
  return (
    <>
      {visibleSections(module).map((section, index) => (
        <div key={section.label ?? index} className="flex flex-col gap-px">
          {section.label ? (
            <span className="px-[0.5625rem] pt-4 pb-[0.3125rem] text-section font-normal text-mute">
              {section.label}
            </span>
          ) : (
            index > 0 && (
              <hr className="mx-[0.5625rem] mt-[0.6875rem] mb-[0.5625rem] border-0 border-t border-hairline" />
            )
          )}
          {section.items.map((item) => (
            <ScreenRow
              key={item.path}
              item={item}
              exact={item.path === module.home}
            />
          ))}
        </div>
      ))}
    </>
  )
}

function ScreenRow({ item, exact }: { item: NavItem; exact: boolean }) {
  const Icon = item.icon
  return (
    <Link
      to={item.path as never}
      activeOptions={{ exact }}
      className="group flex items-center gap-2.5 rounded-lg px-[0.5625rem] py-[0.4375rem] text-nav font-medium text-text transition-colors hover:bg-soft-2 hover:text-ink data-[status=active]:bg-soft-2 data-[status=active]:font-semibold data-[status=active]:text-ink pointer-coarse:min-h-tap"
    >
      <Icon className="size-[1.0625rem] shrink-0 stroke-[1.55] text-line-ico group-data-[status=active]:text-ink" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </Link>
  )
}

/// Who is signed in, and the way out.
function Account() {
  const identity = useIdentity()
  const signOut = useGuardedSignOut()
  const name = identity.data?.display_name ?? identity.data?.username ?? "—"

  return (
    <div className="-mx-[0.1875rem] mt-auto border-t border-hairline pt-2">
      <div className="flex items-center gap-2.5 rounded-inner px-1.5 py-1.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-br from-avatar-from to-avatar-to text-[0.6875rem] font-semibold text-ink">
          {name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[0.8125rem] font-medium text-ink">
            {name}
          </span>
          {identity.data?.role !== undefined && (
            <span className="block truncate text-[0.6875rem] text-mute">
              {identity.data.role.toLowerCase()}
            </span>
          )}
        </span>
        <button
          type="button"
          aria-label="Sign out"
          title="Sign out"
          onClick={signOut.run}
          disabled={signOut.pending}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-line-ico transition-colors hover:bg-soft-2 hover:text-text disabled:opacity-50"
        >
          <LogOut className="size-[0.9375rem] stroke-[1.7]" />
        </button>
      </div>
    </div>
  )
}

/// Signing out, with one question first when sales are still on this device.
/// The queue survives it — it is on disk, not in the session — but the next
/// person at this counter will not know to look, and the sales would sit
/// there until somebody does.
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
