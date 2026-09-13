import { Link, useRouterState } from "@tanstack/react-router"
import { Menu, Search, Settings2, Sparkles } from "lucide-react"

import { domainForPath, domainHome, domains } from "@/lib/navigation"
import { useNodeIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"

/// The bar across the top: which part of the business, and nothing else.
///
/// ## Why there is horizontal chrome again
///
/// There was none. One column carried every question — which department, which
/// screen — and it worked until the column had to hold fourteen departments
/// AND the screens of the one you were in, at which point the screens somebody
/// was working in were below the fold under a list of other people's work.
///
/// Two questions, two places. This bar holds the domains: nine of them, a list
/// that is the shape of the company rather than of the codebase, so it does not
/// grow when screens do. The column under it holds one domain's screens.
///
/// The mark at its left is the company, and it is the only way to Home — Home
/// belongs to no department, so it gets no chip.
export function TopBar({ onOpenNav }: { onOpenNav?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const here = domainForPath(pathname)
  const where = useNodeIdentity()

  return (
    <div className="flex shrink-0 border-b border-hairline bg-soft-3">
      {/* The brand cell is exactly as wide as the narrowed sidebar, so its
          right edge and the sidebar's are the same line from the top of the
          window down. While the sidebar is open the name appears beside the
          mark — as an overlay, so the domains below never shuffle. */}
      <div className="shell-brand relative z-[31] grid h-13 w-16 shrink-0 place-items-center border-r border-hairline bg-soft-3">
        <Link
          to="/"
          aria-label={`${where.data?.node_id ?? "Central"} — home`}
          className="grid size-[1.875rem] place-items-center rounded-inner bg-dark text-[0.6875rem] font-semibold tracking-[0.02em] text-on-dark"
        >
          WM
        </Link>
        <span
          aria-hidden
          className="shell-brandname pointer-events-none absolute top-0 left-16 flex h-full w-44 items-center border-r border-hairline bg-soft-3 pr-4 text-[0.875rem] font-semibold tracking-[-0.01em] whitespace-nowrap text-ink"
        >
          Wira Makmur
        </span>
      </div>

      <header className="flex h-13 min-w-0 flex-1 items-center gap-3 px-5">
        {onOpenNav && (
          <button
            type="button"
            onClick={onOpenNav}
            aria-label="Open navigation"
            // No `md:hidden`. The shell decides whether there is a drawer to
            // open — it passes `onOpenNav` only when the sidebar is undocked —
            // and this class was a second, older answer to the same question.
            // They disagreed: `docked` breaks at `lg` (64rem) and the class hid
            // the button from `md` (48rem), so between 768px and 1024px the
            // shell had no docked sidebar AND no way to open the drawer. That
            // band is an iPad in portrait — 768, 820 and 834 are all in it —
            // where ⌘B, the only remaining way in, cannot be typed.
            className="grid size-tap shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
          >
            <Menu className="size-[1.125rem] stroke-[1.7]" />
          </button>
        )}

        <nav
          aria-label="Domains"
          className="-mx-0.5 -my-0.5 flex min-w-0 flex-1 [scrollbar-width:none] items-center gap-0.5 overflow-x-auto px-0.5 py-0.5 [&::-webkit-scrollbar]:hidden"
        >
          {domains.map((domain) => {
            const Icon = domain.icon
            const current = here?.id === domain.id
            return (
              <Link
                key={domain.id}
                to={domainHome(domain)}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-[0.4375rem] rounded-inner px-2.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors",
                  // Hover is the soft tint, the domain you are in is a chip
                  // lifted off the bar: two marks that cannot be mistaken for
                  // one another.
                  current
                    ? "bg-canvas font-semibold text-ink shadow-[0_0_0_1px_var(--hairline-2),var(--shadow-soft)]"
                    : "text-body hover:bg-soft-2 hover:text-ink",
                  "pointer-coarse:h-[2.375rem]"
                )}
              >
                <Icon
                  className={cn(
                    "size-[0.9375rem] shrink-0 stroke-[1.7]",
                    current ? "text-accent" : "text-line-ico"
                  )}
                />
                {domain.label}
              </Link>
            )
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {/* ⌘K's visible half. It was taken out of the sidebar when the
              sidebar stopped having room for it; a bar has room. */}
          <span className="hidden items-center gap-2 text-[0.8125rem] text-mute lg:inline-flex">
            <Search className="size-4 stroke-[1.7] text-line-ico" />
            Find anything
            <kbd className="rounded-[5px] border border-hairline-2 bg-canvas px-1.5 py-px font-mono text-[0.65625rem] text-body">
              ⌘K
            </kbd>
          </span>
          <Settings2 className="size-[1.0625rem] stroke-[1.55] text-line-ico" />
          <Sparkles className="size-[1.0625rem] stroke-[1.55] text-line-ico" />
          <span
            aria-hidden
            title={where.data?.node_id ?? "cloud"}
            className="size-7 shrink-0 rounded-full bg-gradient-to-br from-[var(--avatar-from,#e9d5ff)] to-[var(--avatar-to,#c7d2fe)]"
          />
        </div>
      </header>
    </div>
  )
}
