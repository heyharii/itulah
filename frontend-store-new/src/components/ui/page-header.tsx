import { useRouterState } from "@tanstack/react-router"

import { screenForPath } from "@/lib/navigation"
import { cn } from "@/lib/utils"

/// Whether the title only repeats what the phone's top bar already says.
///
/// On a phone the top bar names the screen, and a page that opened with the
/// same name under it spent a third of the glass saying where you are. So there
/// the echo is dropped; a title that says something the bar does not (an
/// article's name on its own page) stays. From 48rem up nothing changes.
function useEchoesTopBar(title: React.ReactNode): boolean {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    typeof title === "string" &&
    screenForPath(pathname)?.label.toLowerCase() === title.toLowerCase()
  )
}

/// Every screen opens the same way: an optional crumb, the title, and the
/// actions right-aligned — the hub's (`frontend-hub/src/components/ui/
/// page-header.tsx`).
///
/// One primary action per screen — everything else is secondary. That is why
/// `actions` takes nodes rather than a list: the constraint is a review
/// question, not something a prop can enforce.
///
/// Narrow, the actions drop under the title instead of squeezing beside it.
/// On a phone a list's own actions live in the dock (`DockTools`, `Fab`), so
/// most screens pass none there.
export function PageHeader({
  crumb,
  title,
  actions,
  className,
}: {
  crumb?: React.ReactNode
  title: React.ReactNode
  /// No longer drawn. A screen's title stands alone (owner, 2026-10-05: no
  /// subtitles in any menu); the prop stays so the screens that still pass one
  /// keep compiling, and says nothing.
  sub?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  const echo = useEchoesTopBar(title)
  return (
    <div
      className={cn(
        "flex flex-col items-stretch gap-3",
        "mb-2 md:-mt-1",
        // The actions stand level with the title rather than hanging off its
        // first line: a heading and a 36px button centre on each other.
        "md:flex-row md:items-center md:justify-between md:gap-5",
        echo && (actions ? "max-md:mb-3" : "max-md:hidden"),
        className,
      )}
    >
      <div className={cn("min-w-0", echo && "max-md:hidden")}>
        {crumb && (
          <div className="mb-[0.3125rem] text-[0.875rem] font-medium text-mute">
            {crumb}
          </div>
        )}
        <h1 className="text-[0.9375rem] leading-5 font-semibold text-ink">
          {title}
        </h1>
      </div>
      {actions && (
        // On a phone the actions wrap onto a second line rather than pushing
        // the page sideways.
        <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:flex-nowrap max-md:[&>div]:flex-wrap">
          {actions}
        </div>
      )}
    </div>
  )
}
