import { useRouterState } from "@tanstack/react-router"
import { useLayoutEffect, useRef } from "react"

import { DoorTabs } from "@/components/ui/door-tabs"
import { doorForPath, screenForPath } from "@/lib/navigation"
import { cn } from "@/lib/utils"

/// The page head stays while the page scrolls under it (hub-ui-patterns,
/// 14 Oct), so a table's heading row has to stick UNDER it, not behind it:
/// its height is kept on the root as `--page-head-h` for `DataTable`. Only
/// while it actually sticks — on a phone it does not, and the bar above is
/// the shell's.
function useStuckHeight() {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const head = ref.current
    if (head === null) return
    const root = document.documentElement
    // The box that scrolls the page. Sticky only holds inside its parent, so
    // the head can still leave the top (owner, 14 Oct: the PO headings stood
    // 90px down the table with no head above them). The offset is given
    // only while the head is really at the top of that box.
    //
    // Looked up on every write, and every scroll heard (capture, at the
    // document): found once at mount, it could be no box yet or the wrong
    // one, and then the scroll that took the head away was never heard and
    // the 90px stayed on the table's headings (Suppliers, 14 Oct).
    const boxOf = () => {
      let box: HTMLElement | null = head.parentElement
      while (
        box !== null &&
        !/(auto|scroll)/.test(getComputedStyle(box).overflowY)
      ) {
        box = box.parentElement
      }
      return box
    }
    const write = () => {
      const box = boxOf()
      const stuck = getComputedStyle(head).position === "sticky"
      const top = box === null ? 0 : box.getBoundingClientRect().top
      const held =
        stuck &&
        head.getBoundingClientRect().top <= top + 1 &&
        head.getBoundingClientRect().top >= top - 1
      if (held)
        root.style.setProperty("--page-head-h", `${head.offsetHeight}px`)
      else root.style.removeProperty("--page-head-h")
    }
    write()
    const watch = new ResizeObserver(write)
    watch.observe(head)
    document.addEventListener("scroll", write, { capture: true, passive: true })
    window.addEventListener("resize", write, { passive: true })
    return () => {
      watch.disconnect()
      document.removeEventListener("scroll", write, { capture: true })
      window.removeEventListener("resize", write)
      root.style.removeProperty("--page-head-h")
    }
  }, [])
  return ref
}

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
  const pathname = useRouterState({
    select: (s) => (s.resolvedLocation ?? s.location).pathname,
  })
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
  // Keep the title and tabs with the page still on screen while the next
  // route loads. Its actions must never sit under the next page's heading.
  const pathname = useRouterState({
    select: (s) => (s.resolvedLocation ?? s.location).pathname,
  })
  // A screen that is a tab of a door wears the door's name and its tabs: the
  // screen's own name is the tab, or the view chosen beside the tabs.
  const door = doorForPath(pathname)
  const heading = door ? door.door.label : title
  const echo = useEchoesTopBar(heading)
  // No department in grey over the name any more (owner, 2026-10-15: "hapus
  // Procurement … Purchase Orders"): the rail and the panel already say where
  // the screen sits. `crumb` is still accepted and not drawn.
  void crumb
  const ref = useStuckHeight()
  const row = cn(
    // 24px under the header on a desk (airy charcoal, 2026-09-28): the
    // title is the page's one bold thing and needs the air to be it.
    "flex flex-col items-stretch gap-3",
    // The actions stand level with the title rather than hanging off its
    // first line: a 22px heading and a 36px button centre on each other.
    "md:flex-row md:items-center md:justify-between md:gap-5"
  )
  if (door) {
    return (
      <div
        ref={ref}
        className={cn(
          "page-head page-head-door flex flex-col gap-3 md:-mt-1",
          // On a phone the top bar names the door and the dock holds its tabs,
          // so the head is only the actions — and nothing at all without any.
          !actions && "max-md:hidden",
          className
        )}
      >
        <div className={row}>
          <h1 className="page-title text-[0.9375rem] leading-5 font-semibold text-ink max-md:hidden">
            {heading}
          </h1>
          {actions && (
            <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:flex-nowrap max-md:[&>div]:flex-wrap">
              {actions}
            </div>
          )}
        </div>
        <DoorTabs
          key={door.door.module.id}
          module={door.door.module}
          title={door.door.label}
          tabs={door.door.tabs ?? []}
          tab={door.tab}
          view={door.view}
        />
      </div>
    )
  }
  return (
    <div
      ref={ref}
      className={cn(
        "page-head",
        row,
        "mb-2 md:-mt-1",
        echo && (actions ? "max-md:mb-3" : "max-md:hidden"),
        className
      )}
    >
      <div className={cn("min-w-0", echo && "max-md:hidden")}>
        <h1
          className={cn(
            "page-title font-semibold text-ink",
            "text-[0.9375rem] leading-5"
          )}
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
