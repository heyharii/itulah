import { AppLink } from "@/components/ui/app-link"
import { Mark } from "@/components/shell/mark"
import { sidebarSections } from "@/lib/navigation"
import { useNodeIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"

/// The desk's navigation column.
///
/// This is `frontend-hub/src/components/shell/sidebar.tsx` in this app's
/// tokens, cut down to what a till has: no rail beside it, no module to read
/// off the URL, no badges, no audience filter. One column, three labelled
/// sections, and the same row geometry as the console — 13.5px medium type, a
/// 17px 1.55-weight glyph, and an active row that is a FILL rather than a bar
/// or a colour, because a fill is the one highlight in the column.
///
/// It is drawn at `md` and up only. Below that the floating squircles are the
/// navigation and this would be a second one; above it, the squircles are
/// hidden and this is the only one. Exactly one navigation is on screen at
/// every width, which is what was broken before it existed.
export function TillSidebar({ className }: { className?: string }) {
  const where = useNodeIdentity()
  return (
    <aside
      className={cn(
        "w-[15.5rem] shrink-0 flex-col border-r border-hairline bg-soft px-[0.6875rem] py-[0.8125rem]",
        className,
      )}
    >
      <div className="mb-2.5 flex items-center gap-2 px-[0.5625rem]">
        <Mark className="h-7 w-6 shrink-0 text-line-ico" />
        <b className="min-w-0 flex-1 truncate text-card-title font-semibold text-ink">
          {where.data?.site_id ?? where.data?.node_id ?? "This till"}
        </b>
      </div>

      <nav
        aria-label="Sections"
        className="flex min-h-0 flex-col gap-px overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {sidebarSections.map((section, index) => (
          <div key={section.label} className="flex flex-col gap-px">
            <span
              className={cn(
                "px-[0.5625rem] pb-[0.3125rem] text-section font-semibold tracking-[0.05em] text-mute uppercase",
                index === 0 ? "pt-1" : "pt-4",
              )}
            >
              {section.label}
            </span>
            {section.items.map((item) => {
              const Icon = item.icon
              return (
                <AppLink
                  key={item.path}
                  to={item.path}
                  className="group flex items-center gap-2.5 rounded-lg px-[0.5625rem] py-[0.4375rem] text-nav font-medium text-text transition-colors hover:bg-soft-2 hover:text-ink data-[status=active]:bg-soft-2 data-[status=active]:font-semibold data-[status=active]:text-ink pointer-coarse:min-h-tap"
                >
                  <Icon className="size-[1.0625rem] shrink-0 stroke-[1.55] text-line-ico group-data-[status=active]:text-ink" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </AppLink>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
  )
}
