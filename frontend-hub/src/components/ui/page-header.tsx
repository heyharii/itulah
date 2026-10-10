import { useRouterState } from "@tanstack/react-router"

import { screenForPath } from "@/lib/navigation"
import { cn } from "@/lib/utils"

/// Every screen opens the same way: an optional crumb, the title, an optional
/// sentence under it, and the actions right-aligned.
///
/// One primary action per screen — everything else is secondary. That is why
/// `actions` takes nodes rather than a list: the constraint is a review
/// question, not something a prop can enforce.
///
/// Narrow, the actions drop under the title instead of squeezing beside it.
/// They are a search box and a CTA on most screens, and 375px cannot hold
/// those plus a 22px heading in one row — the version that tries puts the
/// heading in two words per line with a search field lying across it.
/// Whether the title only repeats what the phone's top bar already says.
///
/// On a phone the top bar names the screen (`PhoneTitle`), and a page that
/// opened with the same name in 22px under it — "Purchase orders" twice,
/// with a sentence of description between it and the first row — spent a
/// third of the glass saying where you are. So there the echo is dropped;
/// a title that says something the bar does not (a supplier's name on its
/// own page) stays. From 48rem up nothing changes.
function useEchoesTopBar(title: React.ReactNode): boolean {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    typeof title === "string" &&
    screenForPath(pathname)?.label.toLowerCase() === title.toLowerCase()
  )
}

export function PageHeader({
  crumb,
  title,
  actions,
  className,
}: {
  crumb?: React.ReactNode
  title: React.ReactNode
  /// No longer drawn. A screen's title stands alone (owner, 2026-10-05: "di
  /// semua menu ga ada subtitlenya"); the prop stays so the screens that still
  /// pass one keep compiling, and says nothing.
  sub?: React.ReactNode
  actions?: React.ReactNode
  /// Kept for the callers that pass it: every title is now the quiet 15px one
  /// the Purchase orders screen opened with (owner, 2026-10-05).
  small?: boolean
  className?: string
}) {
  const echo = useEchoesTopBar(title)
  return (
    <div
      className={cn(
        // 24px under the header on a desk (airy charcoal, 2026-09-28): the
        // title is the page's one bold thing and needs the air to be it.
        "flex flex-col items-stretch gap-3",
        "mb-2 md:-mt-1",
        // The actions stand level with the title rather than hanging off its
        // first line: a 22px heading and a 36px button centre on each other.
        "md:flex-row md:items-center md:justify-between md:gap-5",
        echo && (actions ? "max-md:mb-3" : "max-md:hidden"),
        className
      )}
    >
      <div className={cn("min-w-0", echo && "max-md:hidden")}>
        {crumb && (
          <div className="mb-[0.3125rem] text-[0.875rem] font-medium text-mute">
            {crumb}
          </div>
        )}
        <h1
          className={cn("font-semibold text-ink", "text-[0.9375rem] leading-5")}
        >
          {title}
        </h1>
      </div>
      {actions && (
        // On a phone the actions wrap onto a second line rather than pushing
        // the page sideways — "Upload statement", "Record a movement" and a
        // third button do not fit beside each other in 343px. Screens that
        // hand over their buttons in a row of their own get the same rule.
        <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:flex-nowrap max-md:[&>div]:flex-wrap">
          {actions}
        </div>
      )}
    </div>
  )
}
