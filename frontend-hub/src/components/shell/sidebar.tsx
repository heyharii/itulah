import { Link, useRouterState } from "@tanstack/react-router"
import { ChevronsUpDown, HelpCircle, LogOut, Plus, Search } from "lucide-react"

import { count } from "@/lib/format"
import { moduleForPath, type NavItem } from "@/lib/navigation"
import { useIdentity, useNodeIdentity, useSignOut } from "@/lib/session"
import { cn } from "@/lib/utils"

/// The 248px sidebar — nav within the module the rail selected.
///
/// It carries what the (hidden) top bar used to: the workspace chip at the
/// head, the account at the foot. Section labels here are uppercase micro-caps
/// because that is what `inventory-prototype.html` paints; DESIGN.md's
/// sentence-case rule governs *table headers*, which is a different element and
/// the one the brief flagged as the high-blast-radius change.
export function Sidebar({
  open,
  onOpenPalette,
}: {
  open: boolean
  onOpenPalette: () => void
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const active = moduleForPath(pathname)
  /// How many rows this module would actually draw.
  ///
  /// A module that navigates itself — Commercial reaches its four surfaces by
  /// tabs inside the page — is left with one row that repeats the module name
  /// the workspace chip above it already carries. A panel whose whole content
  /// is its own title is chrome, so it is not drawn at all and the screen gets
  /// the width back.
  const rows = active.sections.reduce(
    (total, section) =>
      total + section.items.filter((item) => !item.hidden).length,
    0
  )
  const identity = useIdentity()
  const where = useNodeIdentity()
  const signOut = useSignOut()

  // Nothing to navigate: see `rows` above. The rail still carries the module,
  // and the page carries its own tabs.
  if (rows < 2) return null

  return (
    <aside
      data-open={open}
      className={cn(
        "flex w-[15.5rem] shrink-0 flex-col border-r border-hairline bg-soft px-[0.6875rem] py-[0.8125rem]",
        "min-h-0 transition-[margin] duration-200",
        // Collapsing slides it out rather than unmounting it: the nav keeps its
        // scroll position, and a re-mount would re-run every badge query.
        !open && "-ml-[15.5rem]"
      )}
    >
      {/* workspace chip — takes over what the top bar used to carry */}
      <button
        type="button"
        onClick={onOpenPalette}
        className="mb-2.5 flex items-center gap-1.5 rounded-inner p-1.5 text-left transition-colors hover:bg-soft-2"
      >
        <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-lg bg-ink text-white">
          <Search className="size-[0.875rem]" />
        </span>
        <b className="min-w-0 flex-1 truncate text-[0.90625rem] font-semibold tracking-[-0.015em]">
          {active.label}
        </b>
        <ChevronsUpDown className="size-3.5 shrink-0 stroke-[1.7] text-mute" />
        <span className="grid size-[1.625rem] shrink-0 place-items-center rounded-lg text-line-ico transition-colors hover:bg-soft-2 hover:text-text">
          <Plus className="size-4 stroke-[1.7]" />
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
            {section.items
              .filter((item) => !item.hidden)
              .map((item) => (
              <NavRow
                key={item.path}
                item={item}
                exact={item.path === active.home}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-px pt-2.5">
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-lg px-[0.5625rem] py-1.5 text-meta font-normal text-body transition-colors hover:bg-soft-2 hover:text-ink"
        >
          <HelpCircle className="size-[0.9375rem] text-line-ico" />
          Help &amp; resources
        </button>
        <div className="mt-1.5 flex items-center gap-2.5 rounded-inner border border-hairline p-[0.4375rem_0.5rem]">
          <span className="size-[1.625rem] shrink-0 rounded-full bg-linear-to-br from-avatar-from to-avatar-to" />
          <span className="min-w-0 flex-1 text-[0.78125rem] leading-tight font-medium">
            <span className="block truncate">
              {identity.data?.display_name ?? identity.data?.username ?? "—"}
            </span>
            <small className="block truncate text-[0.6875rem] font-normal text-mute">
              {where.data?.node_id ?? "cloud"}
            </small>
          </span>
          <button
            type="button"
            aria-label="Sign out"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="grid size-[1.625rem] shrink-0 place-items-center rounded-lg text-line-ico transition-colors hover:bg-soft-2 hover:text-text disabled:opacity-50"
          >
            <LogOut className="size-4 stroke-[1.7]" />
          </button>
        </div>
      </div>
    </aside>
  )
}

/// One sidebar entry.
///
/// Its own component so that a module which wants a live count on a row gets
/// one hook call per row, at the top of a component, unconditionally — which is
/// the only way a hook may be called at all. Calling `item.useCount?.()` inside
/// the `.map()` above would be a hook in a loop body, and would break the first
/// time a section's items changed length.
///
/// `noCount` is what makes the call unconditional: an item without a badge hook
/// still calls something, it just calls a function that asks nothing and
/// returns nothing. So the modules that never declare `useCount` — every one of
/// them except finance today — behave exactly as they did before this existed,
/// and pay for exactly nothing.
function NavRow({ item, exact }: { item: NavItem; exact: boolean }) {
  const Icon = item.icon
  const useCount = item.useCount ?? noCount
  const badge = useCount()

  return (
    <Link
      to={item.path}
      activeOptions={{ exact }}
      className="group flex items-center gap-2.5 rounded-lg px-[0.5625rem] py-[0.4375rem] text-nav font-medium text-text transition-colors hover:bg-soft-2 data-[status=active]:bg-soft-2 data-[status=active]:text-ink"
    >
      {/* Active is signalled by the pale pill plus the icon going
          solid — never by a heavier weight. */}
      <Icon className="size-[1.0625rem] shrink-0 stroke-[1.55] text-line-ico group-data-[status=active]:text-ink" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {/* Nothing is drawn at zero, and nothing is drawn while the count is
          still `null`. A badge that appears empty, or blinks on at every page
          load, teaches people to stop reading it. */}
      {typeof badge === "number" && badge > 0 && (
        <span
          className={cn(
            "shrink-0 rounded-full px-[0.375rem] py-px text-[0.65625rem] font-semibold tabular-nums",
            item.badge === "bad"
              ? "bg-bad-bg text-bad-fg"
              : "bg-warn-bg text-warn-fg"
          )}
        >
          {count(badge)}
        </span>
      )}
    </Link>
  )
}

/// The hook an item without a count calls. Asks nothing, subscribes to nothing.
function noCount(): null {
  return null
}
